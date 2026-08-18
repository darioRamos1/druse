using System.Diagnostics;
using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Backups;

/// <summary>Lo que se pide respaldar.</summary>
public sealed record BackupRequest
{
    public required Guid SessionId { get; init; }

    /// <summary>
    /// Tablas elegidas, ya resueltas contra el catálogo.
    ///
    /// Quien las elige es la interfaz; aquí llegan como lista porque un respaldo
    /// tiene que poder repetirse igual desde un perfil guardado, y un árbol de
    /// selección no se guarda: se guarda lo que resultó de él.
    /// </summary>
    public required IReadOnlyList<DatabaseObject> Tables { get; init; }

    public DataSelection Data { get; init; } = new();

    public BackupOutput Output { get; init; } = new();
}

/// <summary>
/// Escribe un respaldo completo: estructura, datos y restricciones, en el orden en
/// que hay que ejecutarlos.
///
/// **El orden no es de presentación.** Todas las tablas primero, luego todos los
/// datos y al final los índices y las claves foráneas:
///
/// - Crear los índices antes de cargar haría que cada fila insertada pagase su
///   mantenimiento.
/// - Las claves foráneas van al final **siempre**, porque entre dos tablas puede
///   haber un ciclo y entonces no existe ningún orden de creación que las
///   satisfaga a la vez.
///
/// Cuando algo falla, **sigue y lo anota**. Una vista sin permisos o una tabla que
/// alguien borró a mitad no pueden tirar tres horas de trabajo; el respaldo
/// termina «con avisos», que no es lo mismo que terminar bien (plan de la función,
/// §7.6). Lo contrario vale al restaurar, que ahí se está modificando.
/// </summary>
public sealed class BackupService(
    IProviderRegistry providers,
    ConnectionService connections,
    IEnumerable<IResultExporter> exporters)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;

    private readonly Dictionary<ExportFormat, IResultExporter> _exporters =
        exporters.ToDictionary(exporter => exporter.Format);

    /// <summary>Versión del artefacto que escribe esta implementación.</summary>
    public const int FormatVersion = 1;

    /// <summary>
    /// El guion que se escribiría, para enseñarlo antes de tocar nada.
    ///
    /// Va por su propio camino y no como una bandera de <see cref="RunAsync"/>:
    /// ver y ejecutar son cosas distintas, y confundirlas aquí acabaría
    /// escribiendo un archivo que solo se quería mirar. Es la misma regla que
    /// separa `previewRowEdits` de `applyRowEdits`.
    ///
    /// **Se limita a propósito.** Una vista previa que leyera la tabla entera
    /// tardaría lo que tarda el respaldo, y nadie va a leer diez mil `INSERT`: se
    /// traen unas pocas filas por tabla y se corta al llegar al tope, diciéndolo.
    /// </summary>
    public async Task<BackupPreview> PreviewAsync(
        BackupRequest request,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var sink = new PreviewSink(MaxPreviewStatements);

        var result = await RunAsync(
            request with
            {
                Data = request.Data with
                {
                    // Sobre los filtros del usuario manda el de la vista previa:
                    // enseñar la primera decena de filas es suficiente para ver
                    // cómo quedan, y leer más solo haría esperar.
                    Filters = Preview(request),
                },
                Output = request.Output with { Data = BackupDataFormat.Inserts },
            },
            sink,
            progress: null,
            cancellationToken);

        return new BackupPreview
        {
            Statements = sink.Statements,
            Truncated = sink.Truncated,
            Warnings = result.Warnings,
        };
    }

    /// <summary>Cuántas instrucciones se enseñan como mucho en una vista previa.</summary>
    private const int MaxPreviewStatements = 200;

    /// <summary>Cuántas filas se leen por tabla al previsualizar.</summary>
    private const int PreviewRows = 10;

    private static Dictionary<string, TableDataFilter> Preview(BackupRequest request)
    {
        var filters = new Dictionary<string, TableDataFilter>(StringComparer.Ordinal);

        foreach (var table in request.Tables)
        {
            var key = DataSelection.KeyOf(table);
            var filter = request.Data.FilterOf(table);

            filters[key] = filter with { MaxRows = Math.Min(filter.MaxRows ?? PreviewRows, PreviewRows) };
        }

        return filters;
    }

    public async Task<BackupProgress> RunAsync(
        BackupRequest request,
        IBackupSink sink,
        IProgress<BackupProgress>? progress,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);
        ArgumentNullException.ThrowIfNull(sink);

        if (!request.Output.IsValid)
        {
            throw new ArgumentException(
                "Los datos en CSV necesitan la salida por carpetas: un archivo suelto " +
                "no puede llevar dentro un archivo por tabla.",
                nameof(request));
        }

        var state = new BackupState(Guid.NewGuid(), request.Tables.Count, progress);

        // El turno cubre el respaldo entero y no cada lectura: la conexión estará
        // ocupada mientras dure, y soltarla entre tablas dejaría que otra cosa se
        // colara en medio de una copia que debería ser un solo momento.
        using var turn = await _connections.EnterAsync(request.SessionId, cancellationToken);

        var session = _connections.Require(request.SessionId);
        var scripter = _providers.GetScripter(session.Engine);
        var metadata = _providers.GetMetadataReader(session.Engine);

        // Todas las tablas se leen bajo la misma instantánea: la de pedidos a las
        // 10:00 y la de líneas a las 10:04 producen un respaldo que no corresponde
        // a ningún momento real de la base. Si el motor no la concede, se sigue y
        // el manifiesto lo dice.
        await using var snapshot = await scripter.BeginSnapshotAsync(session, cancellationToken);

        try
        {
            state.Enter(BackupStep.ReadingStructure);

            var tables = new List<ScriptedTable>(request.Tables.Count);

            foreach (var table in request.Tables)
            {
                cancellationToken.ThrowIfCancellationRequested();
                state.Working(table.Name);

                try
                {
                    tables.Add(new ScriptedTable
                    {
                        Table = table,
                        Columns = await metadata.GetColumnsAsync(session, table, cancellationToken),
                        Structure = await metadata.GetTableStructureAsync(session, table, cancellationToken),
                    });
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    // Una tabla que no se puede leer no tira el respaldo: se dice
                    // cuál y por qué, y el resultado deja de ser un verde limpio.
                    state.Warn(table.Name, $"No se pudo leer su estructura: {error.Message}");
                }
            }

            // --- La estructura ------------------------------------------------
            state.Enter(BackupStep.WritingStructure);

            // Los esquemas van antes que sus tablas, y por eso se escriben aquí y
            // no junto a cada `CREATE TABLE`: sin ellos, aplicar el artefacto
            // sobre una base recién creada falla en la primera instrucción, que
            // es exactamente el caso que la función existe para resolver.
            //
            // Se ordenan por su primera aparición y no alfabéticamente: así el
            // guion se lee en el mismo orden en que se eligieron las tablas.
            foreach (var schema in tables
                .Where(item => request.Data.IncludesStructure(item.Table))
                .Select(item => item.Table.Schema)
                .Where(name => !string.IsNullOrWhiteSpace(name))
                .Distinct(StringComparer.Ordinal))
            {
                cancellationToken.ThrowIfCancellationRequested();

                var creation = scripter.ScriptSchema(schema!);

                if (creation.Count > 0)
                {
                    await sink.WriteAsync(
                        BackupEntryKind.Schema,
                        schema!,
                        Join(creation),
                        cancellationToken);
                }
            }

            foreach (var table in tables.Where(item => request.Data.IncludesStructure(item.Table)))
            {
                cancellationToken.ThrowIfCancellationRequested();
                state.Working(table.Table.Name);

                await sink.WriteAsync(
                    BackupEntryKind.Structure,
                    table.Table.Name,
                    Join(scripter.ScriptTable(table)),
                    cancellationToken);
            }

            // --- Los datos ----------------------------------------------------
            state.Enter(BackupStep.WritingData);

            foreach (var table in tables.Where(item => request.Data.IncludesData(item.Table)))
            {
                cancellationToken.ThrowIfCancellationRequested();

                if (request.Output.Data == BackupDataFormat.Csv)
                {
                    await WriteCsvAsync(session, scripter, sink, request, table, state, cancellationToken);
                }
                else
                {
                    await WriteDataAsync(
                        session,
                        scripter,
                        sink,
                        request,
                        table,
                        state,
                        snapshot,
                        cancellationToken);
                }
            }

            // --- Índices, claves y restricciones ------------------------------
            state.Enter(BackupStep.WritingConstraints);

            foreach (var table in tables.Where(item => request.Data.IncludesStructure(item.Table)))
            {
                cancellationToken.ThrowIfCancellationRequested();
                state.Working(table.Table.Name);

                var indexes = scripter.ScriptIndexes(table);

                // Un índice que no se puede guionizar se queda fuera —mejor eso
                // que un respaldo entero que no se aplica— pero no en silencio: el
                // destino tendrá una tabla igual con un índice menos, y eso solo
                // se nota cuando una consulta va lenta seis meses después.
                var missing = table.Structure.Indexes
                    .Count(index => !index.IsConstraintIndex && !index.IsPrimaryKey) - indexes.Count;

                if (missing > 0)
                {
                    state.Warn(
                        table.Table.Name,
                        $"{missing} índice(s) no se pudieron escribir: este motor no sabe " +
                        "reproducir los que van sobre una expresión.");
                }

                var statements = indexes
                    .Concat(scripter.ScriptForeignKeys(table))
                    .ToList();

                if (statements.Count > 0)
                {
                    await sink.WriteAsync(
                        BackupEntryKind.Constraints,
                        table.Table.Name,
                        Join(statements),
                        cancellationToken);
                }

                state.Finished();
            }

            // --- El artefacto --------------------------------------------------
            state.Enter(BackupStep.Packaging);

            var artifact = await sink.CompleteAsync(
                Manifest(session, request, state, tables, snapshot.IsConsistent),
                cancellationToken);

            return state.Complete(artifact);
        }
        catch (OperationCanceledException)
        {
            // El archivo parcial se tira: un respaldo a medias con aspecto de
            // completo es más peligroso que no tener ninguno.
            await sink.DiscardAsync(CancellationToken.None);

            return state.Cancelled();
        }
        catch (Exception error)
        {
            await sink.DiscardAsync(CancellationToken.None);

            return state.Failed(new BackupFailure(
                state.CurrentObject ?? string.Empty,
                error.Message,
                (error as BackupStatementException)?.Statement));
        }
    }

    private static async Task WriteDataAsync(
        IDatabaseSession session,
        IDatabaseScripter scripter,
        IBackupSink sink,
        BackupRequest request,
        ScriptedTable table,
        BackupState state,
        IBackupSnapshot snapshot,
        CancellationToken cancellationToken)
    {
        // La estimación sale del catálogo y no de un recuento: contar las filas de
        // cada tabla antes de empezar puede costar más que el propio respaldo. Con
        // condición no vale, y entonces la barra va indeterminada.
        var filter = request.Data.FilterOf(table.Table);

        state.Working(
            table.Table.Name,
            string.IsNullOrWhiteSpace(filter.Where) ? table.Table.ApproximateRowCount : null);

        try
        {
            // Lo que abre paso a la identidad se escribe siempre que la tabla la
            // tenga, aunque no haya filas: se sabe antes de leer, y un `ON`
            // seguido de un `OFF` sin nada en medio no hace daño. Averiguar
            // primero si hay filas costaría recorrer la tabla dos veces.
            await WriteAsync(sink, table, scripter.BeginDataLoad(table), cancellationToken);

            var statements = scripter.ScriptDataAsync(session, table, filter, snapshot, cancellationToken);

            await foreach (var statement in statements.WithCancellation(cancellationToken))
            {
                await sink.WriteAsync(
                    BackupEntryKind.Data,
                    table.Table.Name,
                    statement.Sql,
                    cancellationToken);

                state.Rows(statement.Rows);
            }

            await WriteAsync(sink, table, scripter.EndDataLoad(table), cancellationToken);

            state.TableDone();
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            state.Warn(table.Table.Name, $"No se pudieron copiar sus filas: {error.Message}");
        }
    }

    /// <summary>
    /// Las filas de una tabla como CSV, escritas por el mismo exportador que ya
    /// usa el botón de exportar.
    ///
    /// La estructura sigue yendo en `.sql`: lo que cambia es dónde van las filas.
    /// Aquí el progreso salta de golpe al terminar cada tabla —el exportador
    /// devuelve el recuento al final— así que lo que se ve avanzar durante la
    /// escritura es el objeto en curso, no las filas.
    /// </summary>
    /// <summary>
    /// Con qué opciones se escriben los CSV de un respaldo.
    ///
    /// Son las del exportador salvo el tope de filas, que **se quita**: allí
    /// protege de volcar sin querer una tabla entera desde la cuadrícula, y aquí
    /// volcar la tabla entera es justo lo que se ha pedido. Con el tope puesto,
    /// una tabla de tres millones de filas se respaldaría con un millón y el
    /// artefacto no lo diría en ningún sitio.
    /// </summary>
    private static readonly ExportOptions CsvOptions = new() { MaxRows = int.MaxValue };

    private async Task WriteCsvAsync(
        IDatabaseSession session,
        IDatabaseScripter scripter,
        IBackupSink sink,
        BackupRequest request,
        ScriptedTable table,
        BackupState state,
        CancellationToken cancellationToken)
    {
        var filter = request.Data.FilterOf(table.Table);

        state.Working(
            table.Table.Name,
            string.IsNullOrWhiteSpace(filter.Where) ? table.Table.ApproximateRowCount : null);

        if (!_exporters.TryGetValue(ExportFormat.Csv, out var exporter))
        {
            state.Warn(table.Table.Name, "No hay un exportador CSV registrado.");
            return;
        }

        try
        {
            var executor = _providers.GetQueryExecutor(session.Engine);

            await using var reader = await executor.OpenReaderAsync(
                session,
                new QueryRequest
                {
                    SessionId = request.SessionId,
                    Sql = scripter.SelectData(table, filter),
                    MaxRows = int.MaxValue,
                    TimeoutSeconds = 0,
                    DestructiveConfirmed = true,
                },
                cancellationToken);

            var rows = 0L;
            var truncated = false;

            await sink.WriteDataStreamAsync(
                table.Table.Name,
                exporter.FileExtension,
                async (stream, token) =>
                {
                    var result = await exporter.WriteAsync(reader, stream, CsvOptions, token);
                    rows = result.RowCount;
                    truncated = result.Truncated;
                },
                cancellationToken);

            // No debería pasar nunca —el tope está quitado—, pero si pasara sería
            // un respaldo incompleto con aspecto de completo, que es lo peor que
            // puede devolver esta función.
            if (truncated)
            {
                state.Warn(
                    table.Table.Name,
                    "El exportador cortó las filas: el respaldo de esta tabla está incompleto.");
            }

            state.Rows(rows);
            state.TableDone();
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            state.Warn(table.Table.Name, $"No se pudieron copiar sus filas: {error.Message}");
        }
    }

    private static Task WriteAsync(
        IBackupSink sink,
        ScriptedTable table,
        IReadOnlyList<string> statements,
        CancellationToken cancellationToken) =>
        statements.Count == 0
            ? Task.CompletedTask
            : sink.WriteAsync(
                BackupEntryKind.Data,
                table.Table.Name,
                Join(statements),
                cancellationToken);

    private static string Join(IReadOnlyList<string> statements) =>
        statements.Count == 0 ? string.Empty : string.Join(Environment.NewLine, statements);

    private static BackupManifest Manifest(
        IDatabaseSession session,
        BackupRequest request,
        BackupState state,
        List<ScriptedTable> tables,
        bool consistent) => new()
        {
            FormatVersion = FormatVersion,
            DruseVersion = typeof(BackupService).Assembly.GetName().Version?.ToString() ?? "0.0.0",
            CreatedAt = DateTimeOffset.UtcNow,
            Engine = session.Engine,
            ServerVersion = session.ServerVersion,
            Server = session.Profile.Host,
            Database = session.Profile.Database,
            Layout = request.Output.Layout,
            DataFormat = request.Output.Data,
            Tables = tables.Count,
            TablesWithData = tables.Count(table => request.Data.IncludesData(table.Table)),
            Rows = state.TotalRows,
            Outcome = state.Warnings.Count > 0
                ? BackupOutcome.CompletedWithWarnings
                : BackupOutcome.Completed,

            // Lo que el motor concedió de verdad, no lo que se pidió: una base de
            // SQL Server sin instantáneas habilitadas rechaza la transacción, y el
            // respaldo se hace igual pero sin esa garantía.
            ConsistentSnapshot = consistent,
            Warnings = state.Warnings,
        };
}

/// <summary>Un fallo del que se conoce la instrucción que lo provocó.</summary>
public sealed class BackupStatementException(string message, string statement, Exception inner)
    : InvalidOperationException(message, inner)
{
    public string Statement { get; } = statement;
}

/// <summary>
/// Lo que se sabe del respaldo mientras corre.
///
/// Es mutable a propósito y vive en el proceso local: el cliente lo consulta cada
/// medio segundo y necesita leerlo sin interrumpir nada.
/// </summary>
internal sealed class BackupState(Guid id, int objectsTotal, IProgress<BackupProgress>? progress)
{
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly List<BackupWarning> _warnings = [];

    private BackupStep _step;
    private int _objectsDone;
    private long _rowsDone;
    private long? _rowsEstimated;

    public string? CurrentObject { get; private set; }

    public long TotalRows { get; private set; }

    public IReadOnlyList<BackupWarning> Warnings => _warnings;

    public void Enter(BackupStep step)
    {
        _step = step;
        Report();
    }

    public void Working(string name, long? estimated = null)
    {
        CurrentObject = name;
        _rowsDone = 0;
        _rowsEstimated = estimated;
        Report();
    }

    public void Rows(long written)
    {
        _rowsDone += written;
        TotalRows += written;
        Report();
    }

    public void TableDone()
    {
        _rowsEstimated = null;
        Report();
    }

    public void Finished()
    {
        _objectsDone++;
        Report();
    }

    public void Warn(string subject, string message)
    {
        _warnings.Add(new BackupWarning(subject, message));
        Report();
    }

    public BackupProgress Complete(BackupArtifact artifact)
    {
        _step = BackupStep.Done;

        return Report(
            _warnings.Count > 0 ? BackupOutcome.CompletedWithWarnings : BackupOutcome.Completed,
            artifact);
    }

    public BackupProgress Cancelled() => Report(BackupOutcome.Cancelled);

    public BackupProgress Failed(BackupFailure failure) =>
        Report(BackupOutcome.Failed, failure: failure);

    private BackupProgress Report(
        BackupOutcome outcome = BackupOutcome.Running,
        BackupArtifact? artifact = null,
        BackupFailure? failure = null)
    {
        var snapshot = new BackupProgress
        {
            Id = id,
            Step = _step,
            Outcome = outcome,
            CurrentObject = CurrentObject,
            ObjectsDone = _objectsDone,
            ObjectsTotal = objectsTotal,
            RowsDone = _rowsDone,
            RowsEstimated = _rowsEstimated,
            TotalRows = TotalRows,
            Elapsed = _clock.Elapsed,
            Warnings = [.. _warnings],
            Failure = failure,
            Path = artifact?.Path,
            Bytes = artifact?.Bytes,
        };

        progress?.Report(snapshot);

        return snapshot;
    }
}
