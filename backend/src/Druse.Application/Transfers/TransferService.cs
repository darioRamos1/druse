using System.Diagnostics;
using Druse.Application.Abstractions;
using Druse.Application.Backups;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Application.Rows;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Transfers;

/// <summary>Algo que hay que saber de una columna antes de copiarla.</summary>
/// <param name="Column">Columna del destino a la que se refiere.</param>
public sealed record TransferColumnIssue(string Column, string Message);

/// <summary>Lo que se sabe antes de escribir nada en el destino.</summary>
public sealed record TransferPreview
{
    public required IReadOnlyList<ColumnMapping> Mappings { get; init; }

    /// <summary>Columnas obligatorias del destino que no llena nadie.</summary>
    public required IReadOnlyList<string> MissingRequired { get; init; }

    /// <summary>Columnas del origen que no van a ninguna parte.</summary>
    public required IReadOnlyList<string> UnmatchedSource { get; init; }

    public required IReadOnlyList<TransferColumnIssue> Issues { get; init; }

    /// <summary>Estimación del catálogo, o nula si hay condición y no se puede estimar.</summary>
    public long? RowsEstimated { get; init; }

    /// <summary>La consulta con la que se leerá el origen, para poder mirarla.</summary>
    public required string Select { get; init; }

    /// <summary>Las primeras instrucciones que recibiría el destino.</summary>
    public required IReadOnlyList<string> Statements { get; init; }

    /// <summary>
    /// Con qué columnas se reconoce una fila que ya está.
    ///
    /// Vacío en los modos que no reconocen nada. Se devuelve resuelto —si no se
    /// pidieron, es la clave primaria del destino— para que la pantalla enseñe lo
    /// que de verdad se va a usar y no lo que se escribió.
    /// </summary>
    public IReadOnlyList<string> KeyColumns { get; init; } = [];
}

/// <summary>
/// Copia las filas de una tabla a otra, que puede estar en otro esquema, en otra
/// base o al otro lado de otra conexión.
///
/// Es la pieza que faltaba entre las dos que ya existían: importar lleva un
/// **archivo** a una tabla y respaldar lleva una tabla a un **archivo**. Aquí los
/// dos extremos son tablas vivas, y por eso lo que va en medio no puede
/// materializarse: se lee del origen según se escribe en el destino.
///
/// **Se escribe por lotes y cada lote se confirma.** Una transacción que abarque
/// millones de filas revienta el registro del servidor y bloquea la tabla mientras
/// dura; troceando, lo copiado se queda y el resumen dice cuántas filas entraron.
/// Quien prefiera lo contrario para una tabla pequeña lo pide con
/// <see cref="DataTransferRequest.Atomic"/>, y entonces sí va todo en una.
///
/// **Un valor que no cabe para el traslado entero.** Es lo contrario de importar,
/// que enumera todos los problemas para que se corrija el archivo: aquí no hay
/// archivo que corregir, y seguir metiendo filas dejaría en el destino una tabla
/// que nadie sabe describir. Es la misma decisión que toma la restauración.
/// </summary>
public sealed class TransferService(
    IProviderRegistry providers,
    ConnectionService connections,
    MetadataService metadata)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;
    private readonly MetadataService _metadata = metadata;

    /// <summary>Cuántas instrucciones se enseñan como muestra en la vista previa.</summary>
    private const int PreviewedStatements = 5;

    /// <summary>Qué se copiaría y qué habría que mirar antes, sin tocar el destino.</summary>
    public async Task<TransferPreview> PreviewAsync(
        DataTransferRequest request,
        CancellationToken cancellationToken)
    {
        var plan = await PrepareAsync(request, requireConfirmation: false, cancellationToken);

        var editor = _providers.GetRowEditor(plan.TargetEngine);

        // Un lote vacío con las columnas puestas: la instrucción que se enseña es
        // la que se va a ejecutar, y para escribirla no hace falta leer ninguna
        // fila del origen. Previsualizar no debe costar lo que cuesta copiar.
        var sample = new PreparedInsertBatch
        {
            Schema = plan.Target.Table.Schema,
            Table = plan.Target.Table.Name,
            Columns = plan.TargetColumns,
            Rows = [[.. plan.TargetColumns.Select(column => new PreparedCell(column, DBNull.Value, "…"))]],
        };

        return new TransferPreview
        {
            Mappings = plan.Mappings,
            MissingRequired = plan.MissingRequired,
            UnmatchedSource = plan.UnmatchedSource,
            Issues = plan.Issues,
            RowsEstimated = plan.RowsEstimated,
            Select = plan.Select,
            KeyColumns = plan.KeyColumns,
            Statements =
            [
                .. editor.DescribeInsert(sample)
                    .Select(statement => Described(editor, plan, sample, statement))
                    .Take(PreviewedStatements),
            ],
        };
    }

    /// <summary>
    /// La instrucción de muestra, con lo que el modo elegido le añade.
    ///
    /// Enseñar un `INSERT` pelado cuando lo que se va a ejecutar es un `MERGE`
    /// sería enseñar otra cosa, y la vista previa existe justo para que lo que se
    /// lee sea lo que pasa.
    /// </summary>
    private static string Described(
        IRowEditor editor,
        Plan plan,
        PreparedInsertBatch sample,
        string fallback) =>
        plan.OnExisting == ExistingRowAction.Fail
            ? fallback
            : editor.DescribeWrite(sample, plan.OnExisting, plan.KeyColumns) is [var written, ..]
                ? written
                : fallback;

    /// <summary>Copia las filas. Devuelve cuántas llegaron, incluso si falló a mitad.</summary>
    public async Task<TransferProgress> RunAsync(
        DataTransferRequest request,
        IProgress<TransferProgress>? progress,
        CancellationToken cancellationToken)
    {
        var plan = await PrepareAsync(request, requireConfirmation: true, cancellationToken);
        var state = new TransferState(Guid.NewGuid(), Qualified(plan.Target.Table), progress);

        state.Estimate(plan.RowsEstimated);

        // Los turnos se piden **en orden de identificador**, siempre el mismo.
        // Dos traslados cruzados entre las mismas dos conexiones —uno de dev a
        // prod y otro de prod a dev— se quedarían esperando el uno al otro para
        // siempre si cada uno tomase primero el suyo.
        var first = request.SourceSessionId;
        var second = request.TargetSessionId;

        if (first.CompareTo(second) > 0)
        {
            (first, second) = (second, first);
        }

        using var firstTurn = await _connections.EnterAsync(first, cancellationToken);
        using var secondTurn = first == second
            ? null
            : await _connections.EnterAsync(second, cancellationToken);

        try
        {
            return await CopyAsync(request, plan, state, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            // Lo ya confirmado se queda: cancelar no puede deshacer lotes que el
            // destino dio por buenos, y decir lo contrario sería mentir. El
            // recuento del estado es lo que hay allí.
            return state.Cancelled();
        }
        catch (Exception error)
        {
            return state.Failed(new TransferFailure(
                error.Message,
                state.RowsCopied,
                (error as BackupStatementException)?.Statement));
        }
    }

    private async Task<TransferProgress> CopyAsync(
        DataTransferRequest request,
        Plan plan,
        TransferState state,
        CancellationToken cancellationToken)
    {
        var sourceSession = _connections.Require(request.SourceSessionId);
        var targetSession = _connections.Require(request.TargetSessionId);

        // El lado que lee necesita su propia conexión siempre que comparta una con
        // el que escribe: ningún motor de estos admite un lector abierto y un
        // `INSERT` a la vez por el mismo cable. Copiar entre dos esquemas de la
        // misma conexión es un caso corriente, así que esto no es un borde raro.
        await using var reading = await SideAsync(
            sourceSession,
            plan.Source.Table.Database,
            separate: request.SourceSessionId == request.TargetSessionId,
            cancellationToken);

        await using var writing = await SideAsync(
            targetSession,
            plan.Target.Table.Database,
            separate: false,
            cancellationToken);

        var source = reading.Session;
        var target = writing.Session;

        var sourceScripter = _providers.GetScripter(source.Engine);
        var targetScripter = _providers.GetScripter(target.Engine);
        var editor = _providers.GetRowEditor(target.Engine);
        var executor = _providers.GetQueryExecutor(source.Engine);

        // Con «todo o nada» todos los lotes van dentro de una transacción; sin
        // ello, el alcance no abre ninguna y cada `InsertAsync` confirma la suya.
        await using var scope = request.Atomic
            ? await editor.BeginWriteAsync(target, cancellationToken)
            : null;

        if (request.Mode == TransferMode.Replace)
        {
            state.Enter(TransferStep.ClearingTarget);

            foreach (var statement in targetScripter.ScriptClearTable(plan.Target))
            {
                await Apply(targetScripter, target, statement, cancellationToken);
            }
        }

        state.Enter(TransferStep.CopyingRows);

        // Abrir paso a las columnas que genera el motor. Se hace aunque no haya
        // filas: se sabe antes de leer, y un `ON` seguido de un `OFF` sin nada en
        // medio no hace daño, mientras que averiguar si hay filas costaría
        // recorrer la tabla dos veces.
        var opened = request.KeepIdentity ? targetScripter.BeginDataLoad(plan.Target) : [];

        foreach (var statement in opened)
        {
            await Apply(targetScripter, target, statement, cancellationToken);
        }

        try
        {
            await ReadAndWriteAsync(
                request,
                plan,
                state,
                source,
                target,
                sourceScripter,
                executor,
                editor,
                cancellationToken);
        }
        finally
        {
            if (opened.Count > 0)
            {
                // Cerrar lo que se abrió va aquí y no después del `try`: si el
                // traslado falla, la identidad de esa tabla se quedaría abierta
                // para el resto de la sesión, y eso es un estado que nadie ve.
                foreach (var statement in targetScripter.EndDataLoad(plan.Target))
                {
                    await Apply(targetScripter, target, statement, CancellationToken.None);
                }
            }
        }

        if (scope is not null)
        {
            await scope.CommitAsync(cancellationToken);
            state.Committed();
        }

        return state.Complete();
    }

    private static async Task ReadAndWriteAsync(
        DataTransferRequest request,
        Plan plan,
        TransferState state,
        IDatabaseSession source,
        IDatabaseSession target,
        IDatabaseScripter sourceScripter,
        IQueryExecutor executor,
        IRowEditor editor,
        CancellationToken cancellationToken)
    {
        await using var reader = await executor.OpenReaderAsync(
            source,
            new QueryRequest
            {
                SessionId = source.Id,
                Sql = plan.Select,
                MaxRows = int.MaxValue,
                TimeoutSeconds = 0,
                DestructiveConfirmed = true,
            },
            cancellationToken);

        // A qué columna del destino va cada columna que devuelve el lector. Se
        // empareja por **nombre** y no por posición: el `SELECT` lo escribe el
        // dialecto del origen y su orden no es un contrato.
        var targets = Targets(reader.Columns, plan);

        var batch = new List<IReadOnlyList<string?>>(request.ValidBatchSize);
        var firstRow = 1L;

        await foreach (var row in reader.ReadRowsAsync(cancellationToken))
        {
            // El lector devuelve el mismo búfer en cada vuelta, así que la fila se
            // copia antes de guardarla. Sin esta copia el lote entero acabaría
            // siendo la última fila repetida mil veces.
            batch.Add([.. row]);

            if (batch.Count < request.ValidBatchSize)
            {
                continue;
            }

            firstRow = await FlushAsync(
                plan, state, target, editor, targets, batch, firstRow, cancellationToken);
        }

        if (batch.Count > 0)
        {
            await FlushAsync(
                plan, state, target, editor, targets, batch, firstRow, cancellationToken);
        }
    }

    /// <summary>Convierte el lote, lo escribe y lo vacía. Devuelve el número de la fila siguiente.</summary>
    private static async Task<long> FlushAsync(
        Plan plan,
        TransferState state,
        IDatabaseSession target,
        IRowEditor editor,
        IReadOnlyList<DatabaseColumn?> targets,
        List<IReadOnlyList<string?>> batch,
        long firstRow,
        CancellationToken cancellationToken)
    {
        var prepared = RowBatchPlanner.Prepare(
            plan.Target.Table.Schema,
            plan.Target.Table.Name,
            targets,
            batch,
            firstRow);

        if (prepared.Problems.Count > 0)
        {
            var problem = prepared.Problems[0];

            throw new InvalidOperationException(
                $"La fila {problem.Row} no cabe en «{problem.Column}»: {problem.Message}. " +
                "El traslado se detiene aquí para no dejar en el destino filas que " +
                "no se corresponden con el origen.");
        }

        var result = await editor.WriteAsync(
            target,
            prepared.Batch,
            plan.OnExisting,
            plan.KeyColumns,
            cancellationToken);

        state.Rows(result.RowsAffected, result.RowsSkipped);

        var next = firstRow + batch.Count;

        batch.Clear();

        return next;
    }

    /// <summary>A qué columna del destino va cada columna que devuelve el lector.</summary>
    private static IReadOnlyList<DatabaseColumn?> Targets(
        IReadOnlyList<ResultColumn> columns,
        Plan plan)
    {
        var mapped = plan.Mappings
            .Where(mapping => mapping.Target is not null)
            .ToDictionary(
                mapping => mapping.Source,
                mapping => mapping.Target!,
                StringComparer.OrdinalIgnoreCase);

        var byName = plan.Target.Columns.ToDictionary(
            column => column.Name,
            StringComparer.OrdinalIgnoreCase);

        return
        [
            .. columns.Select(column =>
                mapped.TryGetValue(column.Name, out var target) ? byName[target] : null),
        ];
    }

    /// <summary>
    /// La sesión por la que va un lado del traslado.
    ///
    /// Puede ser la que ya estaba, o una auxiliar con la misma identidad cuando
    /// hace falta otra base o, en el lado que lee, otra conexión. Quien la abre la
    /// cierra, y por eso viaja envuelta en algo que se libera.
    /// </summary>
    private async Task<Side> SideAsync(
        IDatabaseSession session,
        string? database,
        bool separate,
        CancellationToken cancellationToken)
    {
        var wanted = string.IsNullOrWhiteSpace(database) ? session.Profile.Database : database;
        var same = string.Equals(wanted, session.Profile.Database, StringComparison.Ordinal);

        if (same && !separate)
        {
            return new Side(session, Owned: false);
        }

        if (string.IsNullOrWhiteSpace(wanted))
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.UnknownColumn,
                "No se sabe en qué base está la tabla, y para copiar dentro de la " +
                "misma conexión hace falta abrir una segunda: elige la base en el " +
                "explorador antes de trasladar."));
        }

        var provider = _providers.GetProvider(session.Engine);
        var auxiliary = await provider.OpenDatabaseSessionAsync(session, wanted, cancellationToken);

        return new Side(auxiliary, Owned: true);
    }

    private static async Task Apply(
        IDatabaseScripter scripter,
        IDatabaseSession session,
        string statement,
        CancellationToken cancellationToken)
    {
        try
        {
            await scripter.ApplyAsync(session, statement, cancellationToken);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Se envuelve para que el resumen diga **qué instrucción** falló: un
            // «Incorrect syntax near ')'» sin la instrucción delante no se
            // diagnostica ni con el archivo abierto.
            throw new BackupStatementException(error.Message, statement, error);
        }
    }

    private static string Qualified(DatabaseObject table) =>
        string.IsNullOrWhiteSpace(table.Schema) ? table.Name : $"{table.Schema}.{table.Name}";

    /// <summary>Un lado del traslado y si hay que cerrarlo al terminar.</summary>
    private sealed record Side(IDatabaseSession Session, bool Owned) : IAsyncDisposable
    {
        public async ValueTask DisposeAsync()
        {
            if (Owned)
            {
                await Session.DisposeAsync();
            }
        }
    }

    private sealed record Plan
    {
        public required ScriptedTable Source { get; init; }

        public required ScriptedTable Target { get; init; }

        public required DatabaseEngine TargetEngine { get; init; }

        public required IReadOnlyList<ColumnMapping> Mappings { get; init; }

        /// <summary>Columnas del destino que se escriben, en orden.</summary>
        public required IReadOnlyList<string> TargetColumns { get; init; }

        /// <summary>
        /// Las que identifican una fila. Vacío en los modos que no reconocen nada.
        /// </summary>
        public IReadOnlyList<string> KeyColumns { get; init; } = [];

        public required IReadOnlyList<string> MissingRequired { get; init; }

        public required IReadOnlyList<string> UnmatchedSource { get; init; }

        public required IReadOnlyList<TransferColumnIssue> Issues { get; init; }

        public required string Select { get; init; }

        public long? RowsEstimated { get; init; }

        /// <summary>
        /// Qué hacer con la fila que ya está, dicho como lo entiende el editor.
        ///
        /// `Replace` no aparece: allí no queda nada con lo que chocar, porque la
        /// tabla se vacía antes de empezar.
        /// </summary>
        public ExistingRowAction OnExisting => Mode switch
        {
            TransferMode.Upsert => ExistingRowAction.Update,
            TransferMode.SkipExisting => ExistingRowAction.Skip,
            _ => ExistingRowAction.Fail,
        };

        public required TransferMode Mode { get; init; }
    }

    private async Task<Plan> PrepareAsync(
        DataTransferRequest request,
        bool requireConfirmation,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var sourceSession = _connections.Require(request.SourceSessionId);
        var targetSession = _connections.Require(request.TargetSessionId);

        if (targetSession.Profile.ReadOnly)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.ReadOnlyConnection,
                "La conexión de destino está marcada como solo lectura."));
        }

        if (sourceSession.Engine != targetSession.Engine)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.NothingToDo,
                "Todavía no se puede trasladar entre motores distintos: los tipos de " +
                "los dos lados no se corresponden y hay que traducirlos."));
        }

        if (requireConfirmation && !request.Confirmed)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.Unconfirmed,
                "Hay que confirmar el traslado antes de escribir en la tabla de destino."));
        }

        if (request.Mode == TransferMode.Replace && !ConfirmedReplace(request))
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.Unconfirmed,
                $"Vaciar «{request.Target.Name}» no se deshace: para hacerlo hay que " +
                "escribir el nombre de la tabla."));
        }

        // Los metadatos se leen **antes** de tomar ningún turno: cada una de estas
        // llamadas pide el suyo por dentro, y pedirlo dos veces sobre la misma
        // sesión dejaría el traslado esperándose a sí mismo.
        var source = await ScriptedAsync(request.SourceSessionId, request.Source, cancellationToken);
        var target = await ScriptedAsync(request.TargetSessionId, request.Target, cancellationToken);

        var mappings = Resolve(request, source.Columns, target.Columns);
        var used = mappings.Where(mapping => mapping.Target is not null).ToList();

        if (used.Count == 0)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.UnknownColumn,
                "Ninguna columna del origen se corresponde con una del destino."));
        }

        var filter = request.Filter;

        // Lo que no viaja no se lee: las columnas que nadie recibe se excluyen del
        // `SELECT` en vez de traerse para tirarlas. En una tabla con un `blob` que
        // no se copia, eso es la diferencia entre leer megabytes y no leerlos.
        var ignored = source.Columns
            .Select(column => column.Name)
            .Where(name => !mappings.Any(mapping =>
                mapping.Target is not null &&
                string.Equals(mapping.Source, name, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        if (ignored.Count > 0)
        {
            filter = filter with
            {
                ExcludedColumns = [.. filter.ExcludedColumns.Concat(ignored).Distinct(StringComparer.Ordinal)],
            };
        }

        var scripter = _providers.GetScripter(sourceSession.Engine);

        // Arma el `SELECT` y de paso valida el filtro contra la tabla real, que es
        // la única entrada de texto libre que tiene esto.
        var select = scripter.SelectData(source, filter);

        var targetColumns = used.Select(mapping => mapping.Target!).ToList();
        var keyColumns = KeysFor(request, target, targetColumns);

        return new Plan
        {
            Source = source,
            Target = target,
            TargetEngine = targetSession.Engine,
            Mappings = mappings,
            TargetColumns = targetColumns,
            KeyColumns = keyColumns,
            MissingRequired = Missing(target.Columns, targetColumns),
            UnmatchedSource = ignored,
            Issues = Issues(request, target.Columns, targetColumns),
            Select = select,
            Mode = request.Mode,
            RowsEstimated = string.IsNullOrWhiteSpace(filter.Where)
                ? request.Source.ApproximateRowCount
                : null,
        };
    }

    /// <summary>
    /// Qué columnas del destino identifican una fila, comprobando que sirvan.
    ///
    /// Solo importa en los modos que tienen que reconocer lo que ya está; en los
    /// demás devuelve vacío y no se pregunta nada, porque no hay nada que
    /// reconocer.
    ///
    /// **La comprobación de unicidad no es una formalidad.** Con una clave que se
    /// repite, «actualiza la que ya está» toca todas las que coinciden: no falla,
    /// no avisa, y deja el destino con filas que nadie pidió cambiar. Se
    /// comprueba contra el catálogo —clave primaria, restricciones de unicidad e
    /// índices únicos— antes de escribir la primera fila.
    /// </summary>
    private static IReadOnlyList<string> KeysFor(
        DataTransferRequest request,
        ScriptedTable target,
        IReadOnlyList<string> written)
    {
        if (request.Mode is not (TransferMode.Upsert or TransferMode.SkipExisting))
        {
            return [];
        }

        var keys = request.KeyColumns.Count > 0
            ? request.KeyColumns
            : target.Structure.PrimaryKey?.Columns ?? [];

        if (keys.Count == 0)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.NoPrimaryKey,
                $"«{target.Table.Name}» no tiene clave primaria, así que no hay forma de " +
                "saber qué fila del destino es cuál. Elige las columnas que identifican " +
                "la fila, o usa el modo que solo añade."));
        }

        var known = target.Columns.Select(column => column.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

        foreach (var key in keys)
        {
            if (!known.Contains(key))
            {
                throw new RowEditRejectedException(new RowEditRejection(
                    RowEditRefusal.UnknownColumn,
                    $"La tabla de destino no tiene ninguna columna «{key}»."));
            }
        }

        // Las columnas que identifican la fila tienen que llegar con valor: si no
        // se copian, todas las filas se parecerían en la clave y la primera
        // actualizaría a la siguiente.
        var missing = keys
            .Where(key => !written.Contains(key, StringComparer.OrdinalIgnoreCase))
            .ToList();

        if (missing.Count > 0)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.KeyMismatch,
                $"No se copian las columnas que identifican la fila: {string.Join(", ", missing)}. " +
                "Sin ellas no se puede saber qué fila del destino corresponde a cada una " +
                "del origen."));
        }

        if (!IsUnique(target, keys))
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.KeyMismatch,
                $"En «{target.Table.Name}» no hay nada que garantice que {string.Join(", ", keys)} " +
                "no se repita, así que actualizar por esas columnas podría cambiar varias " +
                "filas a la vez. Hace falta una clave primaria, una restricción de unicidad " +
                "o un índice único sobre ellas."));
        }

        return keys;
    }

    /// <summary>El catálogo garantiza que esas columnas juntas no se repiten.</summary>
    private static bool IsUnique(ScriptedTable target, IReadOnlyList<string> keys)
    {
        bool Same(IReadOnlyList<string> columns) =>
            columns.Count == keys.Count &&
            columns.All(column => keys.Contains(column, StringComparer.OrdinalIgnoreCase));

        if (target.Structure.PrimaryKey is { } primary && Same(primary.Columns))
        {
            return true;
        }

        if (target.Structure.UniqueConstraints.Any(unique => Same(unique.Columns)))
        {
            return true;
        }

        // Un índice único sin restricción detrás vale igual: lo que importa es la
        // garantía, no cómo se declaró. Los que van sobre una expresión llegan sin
        // columnas y no dicen nada de estas.
        return target.Structure.Indexes.Any(index =>
            index.IsUnique &&
            index.Filter is null &&
            Same([.. index.Columns.Select(column => column.Name)]));
    }

    private static bool ConfirmedReplace(DataTransferRequest request) =>
        string.Equals(
            request.ReplaceConfirmation?.Trim(),
            request.Target.Name,
            StringComparison.OrdinalIgnoreCase);

    private async Task<ScriptedTable> ScriptedAsync(
        Guid sessionId,
        DatabaseObject table,
        CancellationToken cancellationToken) =>
        new()
        {
            Table = table,
            Columns = await _metadata.GetColumnsAsync(sessionId, table, cancellationToken),
            Structure = await _metadata.GetTableStructureAsync(sessionId, table, cancellationToken),
        };

    /// <summary>
    /// Columnas obligatorias del destino que no llena nadie.
    ///
    /// No impide trasladar —la columna puede tener valor por omisión— pero se
    /// dice, porque es la causa más común de que el motor rechace el primer lote
    /// y con él el traslado entero.
    /// </summary>
    private static List<string> Missing(
        IReadOnlyList<DatabaseColumn> columns,
        IReadOnlyList<string> written) =>
        [
            .. columns
                .Where(column =>
                    !column.IsNullable &&
                    !column.IsGenerated &&
                    column.DefaultValue is null &&
                    !written.Contains(column.Name, StringComparer.OrdinalIgnoreCase))
                .Select(column => column.Name),
        ];

    private static List<TransferColumnIssue> Issues(
        DataTransferRequest request,
        IReadOnlyList<DatabaseColumn> columns,
        IReadOnlyList<string> written)
    {
        var issues = new List<TransferColumnIssue>();

        foreach (var column in columns.Where(column => column.IsGenerated))
        {
            if (!written.Contains(column.Name, StringComparer.OrdinalIgnoreCase))
            {
                continue;
            }

            issues.Add(new TransferColumnIssue(
                column.Name,
                request.KeepIdentity
                    ? "La genera el motor y se van a escribir los valores del origen. " +
                      "Es lo que hay que hacer para que lo que apunta a estas filas siga " +
                      "apuntando a ellas, pero fallará si alguno de esos valores ya está."
                    : "La genera el motor y se ha pedido no conservar los valores del " +
                      "origen: el destino asignará otros, y lo que apuntase a estas filas " +
                      "por su identificador dejará de encontrarlas."));
        }

        return issues;
    }

    /// <summary>
    /// Decide qué columna del origen va a cuál del destino.
    ///
    /// Sin indicaciones se emparejan por nombre sin distinguir mayúsculas, y lo
    /// que no case se queda fuera en lugar de colocarse por posición. Adivinar ahí
    /// es exactamente como se copian teléfonos a la columna del código postal, y
    /// entre dos tablas de verdad el error no lo ve nadie hasta mucho después.
    /// </summary>
    private static List<ColumnMapping> Resolve(
        DataTransferRequest request,
        IReadOnlyList<DatabaseColumn> source,
        IReadOnlyList<DatabaseColumn> target)
    {
        if (request.Mappings.Count > 0)
        {
            var sources = source.Select(column => column.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
            var targets = target.Select(column => column.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var mapping in request.Mappings)
            {
                if (!sources.Contains(mapping.Source))
                {
                    throw new RowEditRejectedException(new RowEditRejection(
                        RowEditRefusal.UnknownColumn,
                        $"La tabla de origen no tiene ninguna columna «{mapping.Source}»."));
                }

                if (mapping.Target is not null && !targets.Contains(mapping.Target))
                {
                    throw new RowEditRejectedException(new RowEditRejection(
                        RowEditRefusal.UnknownColumn,
                        $"La tabla de destino no tiene ninguna columna «{mapping.Target}»."));
                }
            }

            var repeated = request.Mappings
                .Where(mapping => mapping.Target is not null)
                .GroupBy(mapping => mapping.Target!, StringComparer.OrdinalIgnoreCase)
                .FirstOrDefault(group => group.Count() > 1);

            if (repeated is not null)
            {
                throw new RowEditRejectedException(new RowEditRejection(
                    RowEditRefusal.UnknownColumn,
                    $"Dos columnas del origen van a «{repeated.Key}»: una columna del " +
                    "destino solo puede recibir una."));
            }

            return [.. request.Mappings];
        }

        return
        [
            .. source.Select(column => new ColumnMapping(
                column.Name,
                target.FirstOrDefault(candidate =>
                    string.Equals(candidate.Name, column.Name, StringComparison.OrdinalIgnoreCase))?.Name)),
        ];
    }
}

/// <summary>
/// Lo que se sabe del traslado mientras corre.
///
/// Es mutable a propósito y vive en el proceso local: el cliente lo consulta cada
/// medio segundo y necesita leerlo sin interrumpir nada.
/// </summary>
internal sealed class TransferState(Guid id, string table, IProgress<TransferProgress>? progress)
{
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    private readonly List<TransferWarning> _warnings = [];

    private TransferStep _step = TransferStep.ReadingStructure;
    private long? _estimated;
    private int _batches;
    private long _skipped;

    public long RowsCopied { get; private set; }

    public void Estimate(long? rows) => _estimated = rows;

    public void Enter(TransferStep step)
    {
        _step = step;
        Report();
    }

    public void Rows(long written, long skipped = 0)
    {
        RowsCopied += written;
        _skipped += skipped;
        _batches++;
        Report();
    }

    /// <summary>Con «todo o nada», los lotes solo cuentan cuando se confirma la transacción.</summary>
    public void Committed() => Report();

    public void Warn(string subject, string message)
    {
        _warnings.Add(new TransferWarning(subject, message));
        Report();
    }

    public TransferProgress Complete()
    {
        _step = TransferStep.Done;

        return Report(_warnings.Count > 0
            ? TransferOutcome.CompletedWithWarnings
            : TransferOutcome.Completed);
    }

    public TransferProgress Cancelled() => Report(TransferOutcome.Cancelled);

    public TransferProgress Failed(TransferFailure failure) =>
        Report(TransferOutcome.Failed, failure);

    private TransferProgress Report(
        TransferOutcome outcome = TransferOutcome.Running,
        TransferFailure? failure = null)
    {
        var snapshot = new TransferProgress
        {
            Id = id,
            Step = _step,
            Outcome = outcome,
            CurrentObject = table,
            RowsCopied = RowsCopied,
            RowsEstimated = _estimated,
            RowsSkipped = _skipped,
            BatchesDone = _batches,
            Elapsed = _clock.Elapsed,
            Warnings = [.. _warnings],
            Failure = failure,
        };

        progress?.Report(snapshot);

        return snapshot;
    }
}
