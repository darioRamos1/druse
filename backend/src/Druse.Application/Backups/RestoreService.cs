using System.Diagnostics;
using System.Text.RegularExpressions;

using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Backups;

/// <summary>Lo que se pide restaurar.</summary>
public sealed record RestoreRequest
{
    public required Guid SessionId { get; init; }

    /// <summary>Archivo o carpeta que se aplica. La elige el usuario.</summary>
    public required string Path { get; init; }

    /// <summary>
    /// Desde qué instrucción se sigue, contando desde uno.
    ///
    /// Cero es empezar por el principio. Lo demás es reanudar una restauración
    /// que se paró: se salta lo ya aplicado en lugar de repetirlo, que en un
    /// `CREATE TABLE` fallaría y en un `INSERT` duplicaría filas.
    /// </summary>
    public int ResumeFrom { get; init; }
}

/// <summary>
/// Aplica un respaldo sobre una base.
///
/// **Aquí se escribe, y eso cambia todas las reglas respecto a respaldar.** Al
/// leer, un objeto roto se anota y se sigue; al escribir, seguir tras un error
/// deja un destino a medias que nadie sabe describir. Se para en la instrucción
/// que falló, se dice cuál era y hasta dónde se había llegado, y se ofrece
/// reanudar desde ahí (plan §7.6).
///
/// Por lo mismo no hay transacción que envuelva la restauración entera: ver el
/// contrato de <see cref="IDatabaseScripter.ApplyAsync"/>.
/// </summary>
public sealed partial class RestoreService(
    IProviderRegistry providers,
    ConnectionService connections,
    MetadataService metadata,
    IBackupArchiveFactory archives)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;
    private readonly MetadataService _metadata = metadata;
    private readonly IBackupArchiveFactory _archives = archives;

    /// <summary>Versión de formato que esta implementación sabe leer.</summary>
    public const int SupportedFormat = 1;

    /// <summary>
    /// Qué trae el artefacto y qué pasaría al aplicarlo aquí, **sin tocar nada**.
    ///
    /// Es lo que se enseña antes de decidir. Se leen el manifiesto y las
    /// instrucciones, se comprueba que el destino admite el respaldo, y se mira
    /// en su catálogo qué tablas de las que trae ya existen: restaurar encima de
    /// lo que hay es el caso más común y el más fácil de lamentar.
    /// </summary>
    public async Task<RestoreInspection> InspectAsync(
        Guid sessionId,
        string path,
        CancellationToken cancellationToken)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);

        var session = _connections.Require(sessionId);
        var rejections = new List<RestoreRejection>();

        ArchiveSummary summary;

        try
        {
            summary = await ReadAsync(path, cancellationToken);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return new RestoreInspection
            {
                Path = path,
                Layout = BackupLayout.SingleFile,
                Rejections =
                [
                    new RestoreRejection(
                        RestoreRefusal.Unreadable,
                        $"No se pudo leer «{path}»: {error.Message}"),
                ],
            };
        }

        if (session.Profile.ReadOnly)
        {
            rejections.Add(new RestoreRejection(
                RestoreRefusal.ReadOnlyConnection,
                "La conexión está marcada como solo lectura: no se puede restaurar sobre ella."));
        }

        if (summary.Manifest is { } manifest)
        {
            // El motor no se traduce. Un respaldo de SQL Server no se aplica en
            // PostgreSQL: los tipos, la identidad y hasta las comillas son otras,
            // y fallaría a mitad dejando media base creada.
            if (manifest.Engine != session.Engine)
            {
                rejections.Add(new RestoreRejection(
                    RestoreRefusal.DifferentEngine,
                    $"El respaldo es de {manifest.Engine} y esta conexión es de {session.Engine}."));
            }

            // Un formato **mayor** que el conocido lo escribió un Druse más nuevo:
            // negarse con un mensaje claro es mejor que reventar a mitad.
            if (manifest.FormatVersion > SupportedFormat)
            {
                rejections.Add(new RestoreRejection(
                    RestoreRefusal.UnknownFormat,
                    $"El respaldo usa el formato {manifest.FormatVersion} y esta versión de Druse " +
                    $"llega al {SupportedFormat}. Actualiza Druse para restaurarlo."));
            }
        }

        var warnings = new List<BackupWarning>(summary.Manifest?.Warnings ?? []);

        if (summary.Manifest is null)
        {
            warnings.Add(new BackupWarning(
                string.Empty,
                "El artefacto no trae manifiesto: no se puede comprobar de qué motor viene."));
        }
        else if (summary.Manifest.Outcome is BackupOutcome.Failed or BackupOutcome.Cancelled)
        {
            warnings.Add(new BackupWarning(
                string.Empty,
                $"El respaldo quedó {summary.Manifest.Outcome} y puede estar incompleto."));
        }

        return new RestoreInspection
        {
            Path = path,
            Layout = summary.Layout,
            Compressed = summary.Compressed,
            Manifest = summary.Manifest,
            Statements = summary.Statements,
            Tables = summary.Tables,
            Collisions = rejections.Count > 0
                ? []
                : await CollisionsAsync(sessionId, summary.Tables, cancellationToken),
            Rejections = rejections,
            Warnings = warnings,
        };
    }

    /// <summary>
    /// Aplica el artefacto, contando por dónde va.
    ///
    /// Devuelve el estado final; el progreso intermedio va por
    /// <paramref name="progress"/>, que es lo que sondea la pantalla.
    /// </summary>
    public async Task<RestoreProgress> RunAsync(
        RestoreRequest request,
        IProgress<RestoreProgress>? progress,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var state = new RestoreState(Guid.NewGuid(), progress);

        using var turn = await _connections.EnterAsync(request.SessionId, cancellationToken);

        var session = _connections.Require(request.SessionId);

        if (session.Profile.ReadOnly)
        {
            throw new InvalidOperationException(
                "La conexión está marcada como solo lectura: no se puede restaurar sobre ella.");
        }

        var scripter = _providers.GetScripter(session.Engine);

        state.Enter(RestoreStep.Reading);

        using var archive = _archives.Open(request.Path);

        // Se cuentan antes de empezar para poder dibujar una barra honesta: sin
        // el total, la única opción sería una barra indeterminada durante media
        // hora. Se paga una lectura entera del archivo, que es barata al lado de
        // ejecutarlo.
        state.Total(await CountAsync(archive, cancellationToken));
        state.Enter(RestoreStep.Applying);

        var index = 0;

        try
        {
            await foreach (var statement in archive.ReadStatementsAsync(cancellationToken))
            {
                cancellationToken.ThrowIfCancellationRequested();

                index++;

                // Reanudar es saltarse lo ya aplicado, no volver a ejecutarlo: un
                // `CREATE TABLE` repetido falla y un `INSERT` repetido duplica.
                if (index <= request.ResumeFrom)
                {
                    state.Skipped();
                    continue;
                }

                state.Working(SubjectOf(statement));

                try
                {
                    state.Wrote(await scripter.ApplyAsync(session, statement, cancellationToken));
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    return state.Failed(index, statement, error);
                }
            }
        }
        catch (OperationCanceledException)
        {
            return state.Cancelled();
        }
        finally
        {
            session.Transaction.Touch();
        }

        return state.Completed();
    }

    /// <summary>Cuántas instrucciones tiene el artefacto.</summary>
    private static async Task<int> CountAsync(
        IBackupArchive archive,
        CancellationToken cancellationToken)
    {
        var count = 0;

        await foreach (var _ in archive.ReadStatementsAsync(cancellationToken))
        {
            count++;
        }

        return count;
    }

    private sealed record ArchiveSummary(
        BackupLayout Layout,
        bool Compressed,
        BackupManifest? Manifest,
        int Statements,
        IReadOnlyList<string> Tables);

    /// <summary>Lee el artefacto entero una vez: manifiesto, recuento y tablas.</summary>
    private async Task<ArchiveSummary> ReadAsync(
        string path,
        CancellationToken cancellationToken)
    {
        using var archive = _archives.Open(path);

        var manifest = await archive.ReadManifestAsync(cancellationToken);
        var tables = new List<string>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var statements = 0;

        await foreach (var statement in archive.ReadStatementsAsync(cancellationToken))
        {
            statements++;

            if (SubjectOf(statement) is { } table && seen.Add(table))
            {
                tables.Add(table);
            }
        }

        return new ArchiveSummary(
            archive.Layout,
            archive.Compressed,
            manifest,
            statements,
            tables);
    }

    /// <summary>
    /// Las tablas del artefacto que ya existen en el destino, con sus filas.
    ///
    /// Se leen del catálogo y no se pregunta tabla a tabla: son dos lecturas del
    /// árbol frente a una consulta por nombre, y el árbol ya está cacheado.
    /// </summary>
    private async Task<IReadOnlyList<RestoreCollision>> CollisionsAsync(
        Guid sessionId,
        IReadOnlyList<string> tables,
        CancellationToken cancellationToken)
    {
        if (tables.Count == 0)
        {
            return [];
        }

        var existing = new Dictionary<string, DatabaseObject>(StringComparer.OrdinalIgnoreCase);

        try
        {
            foreach (var table in await TablesAsync(sessionId, cancellationToken))
            {
                existing[DataSelection.KeyOf(table)] = table;
            }
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Sin catálogo se restaura igual: no poder avisar de lo que se
            // sobrescribe no es motivo para impedirlo, pero tampoco se finge que
            // no hay nada.
            return [];
        }

        return
        [
            .. tables
                .Where(existing.ContainsKey)
                .Select(table => new RestoreCollision(table, existing[table].ApproximateRowCount)),
        ];
    }

    /// <summary>Hasta dónde se baja por el árbol buscando tablas.</summary>
    private const int MaxDepth = 6;

    /// <summary>
    /// Las tablas que hoy tiene la base de la sesión.
    ///
    /// Se pide por el mismo camino que el explorador y no con una consulta al
    /// catálogo escrita aquí: es lo que ya sabe hacerlo en los cuatro motores, y
    /// una segunda forma de listar tablas sería una segunda forma de que se
    /// escapen las vistas.
    /// </summary>
    private async Task<IReadOnlyList<DatabaseObject>> TablesAsync(
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        var session = _connections.Require(sessionId);
        var databases = await _metadata.GetDatabasesAsync(sessionId, cancellationToken);

        if (databases.Count == 0)
        {
            return [];
        }

        var current = databases.FirstOrDefault(database =>
            string.Equals(
                database.Name,
                session.Profile.Database,
                StringComparison.OrdinalIgnoreCase))
            ?? databases[0];

        return await UnderAsync(sessionId, current, 0, cancellationToken);
    }

    private async Task<IReadOnlyList<DatabaseObject>> UnderAsync(
        Guid sessionId,
        DatabaseObject parent,
        int depth,
        CancellationToken cancellationToken)
    {
        if (parent.Kind == DatabaseObjectKind.Table)
        {
            return [parent];
        }

        if (depth >= MaxDepth)
        {
            return [];
        }

        var found = new List<DatabaseObject>();

        foreach (var child in await _metadata.GetChildrenAsync(sessionId, parent, cancellationToken))
        {
            if (child.Kind == DatabaseObjectKind.Table)
            {
                found.Add(child);
                continue;
            }

            if (child.Kind is DatabaseObjectKind.Folder or DatabaseObjectKind.Schema)
            {
                found.AddRange(await UnderAsync(sessionId, child, depth + 1, cancellationToken));
            }
        }

        return found;
    }

    /// <summary>
    /// Sobre qué tabla va una instrucción, para poder decirlo mientras corre.
    ///
    /// Se saca del propio SQL y no del nombre del archivo porque en la salida de
    /// un solo `.sql` no hay archivos. Es una lectura del texto y puede no
    /// acertar con SQL que Druse no escribió; entonces se calla en vez de
    /// inventar un nombre.
    /// </summary>
    private static string? SubjectOf(string statement)
    {
        var match = Subject().Match(statement);

        if (!match.Success)
        {
            return null;
        }

        var name = match.Groups["name"].Value;

        return Unquote(name);
    }

    /// <summary>Quita las comillas de los cuatro dialectos y deja `esquema.tabla`.</summary>
    private static string Unquote(string name) =>
        string.Join(
            '.',
            name.Split('.')
                .Select(part => part.Trim().Trim('"', '[', ']', '`'))
                .Where(part => part.Length > 0));

    [GeneratedRegex(
        """(?:CREATE\s+TABLE|INSERT\s+INTO|ALTER\s+TABLE)\s+(?<name>(?:[^\s(]+))""",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex Subject();

    /// <summary>
    /// Lleva la cuenta de la restauración y avisa a quien la mira.
    ///
    /// Es la misma idea que en el respaldo: el estado se publica cada vez que
    /// cambia algo que se ve, no cada instrucción, porque treinta mil `INSERT`
    /// producirían treinta mil actualizaciones para mover una barra que solo
    /// tiene cien posiciones.
    /// </summary>
    private sealed class RestoreState(Guid id, IProgress<RestoreProgress>? progress)
    {
        /// <summary>Cada cuántas instrucciones se vuelve a publicar el estado.</summary>
        private const int ReportEvery = 50;

        private readonly Stopwatch _clock = Stopwatch.StartNew();
        private readonly List<BackupWarning> _warnings = [];

        private RestoreStep _step;
        private string? _current;
        private int _done;
        private int _total;
        private long _rows;
        private int _sinceReport;

        public void Enter(RestoreStep step)
        {
            _step = step;
            Publish();
        }

        public void Total(int statements)
        {
            _total = statements;
            Publish();
        }

        public void Working(string? subject)
        {
            if (subject is not null && subject != _current)
            {
                _current = subject;
                _sinceReport = ReportEvery;
            }
        }

        public void Wrote(long rows)
        {
            _done++;
            _rows += rows;

            if (++_sinceReport >= ReportEvery)
            {
                Publish();
            }
        }

        /// <summary>Una instrucción que se saltó al reanudar: cuenta pero no escribe.</summary>
        public void Skipped()
        {
            _done++;

            if (++_sinceReport >= ReportEvery)
            {
                Publish();
            }
        }

        public RestoreProgress Completed() => Final(RestoreOutcome.Completed, null);

        public RestoreProgress Cancelled() => Final(RestoreOutcome.Cancelled, null);

        public RestoreProgress Failed(int index, string statement, Exception error) =>
            Final(
                RestoreOutcome.Failed,
                new RestoreFailure(index, statement, error.Message));

        private RestoreProgress Final(RestoreOutcome outcome, RestoreFailure? failure)
        {
            _step = RestoreStep.Done;

            var state = Snapshot() with { Outcome = outcome, Failure = failure };

            progress?.Report(state);

            return state;
        }

        private void Publish()
        {
            _sinceReport = 0;
            progress?.Report(Snapshot());
        }

        private RestoreProgress Snapshot() => new()
        {
            Id = id,
            Step = _step,
            Outcome = RestoreOutcome.Running,
            CurrentObject = _current,
            StatementsDone = _done,
            StatementsTotal = _total,
            RowsWritten = _rows,
            Elapsed = _clock.Elapsed,
            Applied = _done,
            Warnings = _warnings,
        };
    }
}
