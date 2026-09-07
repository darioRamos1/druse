using System.Diagnostics;
using System.Text.RegularExpressions;

using Druse.Application.Abstractions;
using Druse.Application.Connections;
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

    /// <summary>
    /// Base **nueva** que se crea para meter dentro el respaldo.
    ///
    /// Vacío es lo de siempre: aplicarlo sobre la base abierta. Con un nombre se
    /// crea esa base y se restaura ahí, que es como se trae una copia entera sin
    /// tocar nada de lo que ya hay. **Nunca se usa una base que ya exista**: eso
    /// sería sobrescribirla creyendo que se está copiando.
    /// </summary>
    public string? NewDatabase { get; init; }

    /// <summary>
    /// La huella que devolvió la inspección de este mismo artefacto.
    ///
    /// Es la forma de decir «aplica **esto**, lo que miré» en vez de «aplica lo
    /// que haya en esa ruta». Entre mirar y aceptar cabe cualquier cosa: que el
    /// archivo se sobrescriba, que la carpeta se llene con otro respaldo. Sin
    /// ella no se restaura: no hay forma de saber si lo que hay delante es lo que
    /// se aprobó.
    /// </summary>
    public string? Fingerprint { get; init; }
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
    IBackupArchiveFactory archives)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;
    private readonly IBackupArchiveFactory _archives = archives;

    /// <summary>Versión de formato que esta implementación sabe leer.</summary>
    public const int SupportedFormat = BackupManifest.ReversibleFormat;

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

        var collisions = rejections.Count > 0
            ? new CollisionReport([], Known: true)
            : await CollisionsAsync(sessionId, summary.Tables, cancellationToken);

        var warnings = new List<BackupWarning>(summary.Manifest?.Warnings ?? []);

        // Sin catálogo no se sabe qué hay al otro lado. Se dice, porque la
        // alternativa es que la pantalla enseñe «no se sobrescribe nada» sin que
        // nadie lo haya comprobado.
        if (!collisions.Known)
        {
            warnings.Add(new BackupWarning(
                string.Empty,
                "No se pudo leer el catálogo del destino: no se sabe qué tablas de este " +
                "respaldo ya existen ahí ni qué se va a sobrescribir."));
        }

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

        // Los CSV del formato 1 escribían igual el nulo y la cadena vacía, así que
        // al restaurarlos los dos entran como cadena vacía. Se restaura —negarse
        // sería peor—, pero quien lo haga tiene que saber qué recibe.
        //
        // Un artefacto sin manifiesto cuenta como antiguo: no dice su formato, y
        // suponerle el nuevo sería suponer justo lo que no se puede comprobar.
        // Desde el formato 2 no hay nada que avisar, y un aviso que no advierte de
        // nada enseña a no leerlos.
        if (summary.CsvRows > 0 &&
            summary.Manifest?.FormatVersion is not (int and >= BackupManifest.ReversibleFormat))
        {
            var formato = summary.Manifest is null
                ? "sin manifiesto que diga su formato"
                : $"del formato {summary.Manifest.FormatVersion}";

            warnings.Add(new BackupWarning(
                string.Empty,
                $"Los datos vienen en CSV {formato} ({summary.CsvRows} filas), donde un nulo y una " +
                "cadena vacía se escribían igual: en las columnas de texto los dos se restaurarán " +
                "como cadena vacía. Para conservar los nulos hay que volver a respaldar con esta " +
                "versión de Druse."));
        }

        return new RestoreInspection
        {
            Path = path,
            Layout = summary.Layout,
            Compressed = summary.Compressed,
            Manifest = summary.Manifest,
            Statements = summary.Statements,
            Tables = summary.Tables,
            Collisions = collisions.Collisions,
            Rejections = rejections,
            Warnings = warnings,
            SourceDatabase = summary.Manifest?.Database,
            Databases = await DatabasesAsync(sessionId, cancellationToken),
            Fingerprint = ArtifactFingerprint.Of(path),
        };
    }

    /// <summary>
    /// Los nombres de las bases que ya hay en el servidor.
    ///
    /// Se mandan con la inspección para que la pantalla pueda decir «ese nombre
    /// ya está cogido» mientras se escribe, en lugar de dejar que lo descubra el
    /// `CREATE DATABASE`.
    /// </summary>
    private async Task<IReadOnlyList<string>> DatabasesAsync(
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        try
        {
            using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

            var session = _connections.Require(sessionId);
            var reader = _providers.GetMetadataReader(session.Engine);

            return [.. (await reader.GetDatabasesAsync(session, cancellationToken))
                .Select(database => database.Name)];
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Sin la lista se restaura igual: lo único que se pierde es el aviso
            // temprano, y el servidor sigue teniendo la última palabra.
            return [];
        }
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
        // Lo que se aplica tiene que ser lo que se miró. Entre inspeccionar y
        // aceptar cabe cualquier cosa —sobrescribir el archivo, dejar otro
        // respaldo en la carpeta—, y lo que se aplicaría entonces sería algo que
        // nadie aprobó, sobre una base de verdad.
        var fingerprint = ArtifactFingerprint.Of(request.Path);

        if (string.IsNullOrWhiteSpace(request.Fingerprint))
        {
            throw new InvalidOperationException(
                "Falta la huella del artefacto inspeccionado. Vuelve a inspeccionarlo antes de " +
                "restaurar: sin ella no se puede saber si lo que hay ahí es lo que se aprobó.");
        }

        if (!string.Equals(request.Fingerprint, fingerprint, StringComparison.Ordinal))
        {
            throw new InvalidOperationException(
                "El artefacto cambió después de inspeccionarlo: no es el mismo que se aprobó. " +
                "Vuelve a inspeccionarlo para ver qué hay ahí ahora.");
        }

        var total = await CountAsync(archive, cancellationToken);

        state.Total(total);

        // Reanudar por encima de lo que trae el artefacto se saltaría todas las
        // entradas y terminaría en verde sin haber aplicado ni una: una
        // restauración que dice que fue bien y no hizo nada. Y un número negativo
        // no significa nada, aunque hoy se comporte como empezar de cero.
        if (request.ResumeFrom < 0 || (total > 0 && request.ResumeFrom >= total))
        {
            throw new InvalidOperationException(
                $"No se puede reanudar desde la instrucción {request.ResumeFrom}: el respaldo " +
                $"trae {total} y se reanuda con un número entre 0 y {total - 1}.");
        }

        // La base nueva, si se pidió una. Se crea **antes** de tocar el artefacto:
        // si el nombre estaba cogido o faltan permisos, mejor enterarse ahora que
        // a mitad de un respaldo de tres millones de filas.
        if (!string.IsNullOrWhiteSpace(request.NewDatabase))
        {
            try
            {
                await CreateAsync(session, scripter, request.NewDatabase, cancellationToken);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                return state.Failed(0, $"CREATE DATABASE {request.NewDatabase}", error);
            }
        }

        // Y a partir de aquí se escribe donde toque: en la base nueva si la hay,
        // y si no en la de la sesión. La sesión auxiliar conserva servidor,
        // usuario y permisos; lo único que cambia es a qué base apunta.
        return await _connections.UseDatabaseAsync(
            session,
            string.IsNullOrWhiteSpace(request.NewDatabase) ? null : request.NewDatabase,
            target => ApplyAsync(target, session, scripter, archive, request, state, cancellationToken),
            cancellationToken);
    }

    /// <summary>
    /// Crea la base donde se va a volcar el respaldo.
    ///
    /// Se comprueba antes que no exista, y no se restaura dentro de una que ya
    /// esté: quien pide «tráemela a una base nueva» está copiando, y encontrarse
    /// con que ha escrito encima de otra cosa no es un matiz.
    /// </summary>
    private async Task CreateAsync(
        IDatabaseSession session,
        IDatabaseScripter scripter,
        string name,
        CancellationToken cancellationToken)
    {
        var reader = _providers.GetMetadataReader(session.Engine);
        var existing = await reader.GetDatabasesAsync(session, cancellationToken);

        if (existing.Any(database =>
                string.Equals(database.Name, name, StringComparison.OrdinalIgnoreCase)))
        {
            throw new InvalidOperationException(
                $"Ya hay una base llamada «{name}» en este servidor. " +
                "Elige otro nombre o restaura sobre ella a propósito.");
        }

        foreach (var statement in scripter.ScriptCreateDatabase(name))
        {
            await scripter.ApplyAsync(session, statement, cancellationToken);
        }
    }

    /// <summary>
    /// Recorre el artefacto y lo va aplicando sobre la base de destino.
    /// </summary>
    /// <param name="target">Dónde se escribe: la base nueva, o la de la sesión.</param>
    /// <param name="session">La sesión del usuario, que es de quien es el turno.</param>
    private async Task<RestoreProgress> ApplyAsync(
        IDatabaseSession target,
        IDatabaseSession session,
        IDatabaseScripter scripter,
        IBackupArchive archive,
        RestoreRequest request,
        RestoreState state,
        CancellationToken cancellationToken)
    {
        state.Enter(RestoreStep.Applying);

        var targets = new RestoreTargets();
        var index = 0;

        BackupEntry? current = null;

        try
        {
            await foreach (var entry in archive.ReadEntriesAsync(cancellationToken))
            {
                cancellationToken.ThrowIfCancellationRequested();

                index++;
                current = entry;

                // Reanudar es saltarse lo ya aplicado, no volver a ejecutarlo: un
                // `CREATE TABLE` repetido falla y un `INSERT` repetido duplica.
                if (index <= request.ResumeFrom)
                {
                    state.Skipped();
                    continue;
                }

                try
                {
                    switch (entry)
                    {
                        case BackupStatement statement:
                            // Lo que abrió el cargador de una tabla se cierra antes
                            // de volver al SQL: `IDENTITY_INSERT` es de la sesión y
                            // solo admite una tabla a la vez.
                            await CloseLoadAsync(target, scripter, targets, cancellationToken);

                            state.Working(SubjectOf(statement.Sql));
                            state.Wrote(await scripter.ApplyAsync(target, statement.Sql, cancellationToken));
                            break;

                        case BackupRows rows:
                            state.Working(rows.Table);
                            state.Wrote(await LoadAsync(target, scripter, targets, rows, state, cancellationToken));
                            break;
                    }
                }
                catch (Exception error) when (error is not OperationCanceledException)
                {
                    return state.Failed(index, Describe(entry), error);
                }
            }

            await CloseLoadAsync(target, scripter, targets, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            return state.Cancelled();
        }
        catch (Exception error)
        {
            // Cerrar el cargador es lo último que se hace y también puede fallar:
            // si se cae ahí, lo que se enseña es la última entrada que se aplicó.
            return state.Failed(index, current is null ? string.Empty : Describe(current), error);
        }
        finally
        {
            session.Transaction.Touch();
        }

        return state.Completed();
    }

    /// <summary>Cuántas entradas tiene el artefacto.</summary>
    private static async Task<int> CountAsync(
        IBackupArchive archive,
        CancellationToken cancellationToken)
    {
        var count = 0;

        await foreach (var _ in archive.ReadEntriesAsync(cancellationToken))
        {
            count++;
        }

        return count;
    }

    /// <summary>Cómo se nombra una entrada cuando hay que decir dónde falló.</summary>
    private static string Describe(BackupEntry entry) => entry switch
    {
        BackupStatement statement => statement.Sql,
        BackupRows rows =>
            $"-- {rows.Rows.Count} filas de «{rows.Table}» desde {rows.Source}, " +
            $"a partir de la fila {rows.FirstRow}",
        _ => string.Empty,
    };

    private sealed record ArchiveSummary(
        BackupLayout Layout,
        bool Compressed,
        BackupManifest? Manifest,
        int Statements,
        long CsvRows,
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
        var csvRows = 0L;

        await foreach (var entry in archive.ReadEntriesAsync(cancellationToken))
        {
            statements++;

            switch (entry)
            {
                case BackupStatement statement when SubjectOf(statement.Sql) is { } table && seen.Add(table):
                    tables.Add(table);
                    break;

                case BackupRows rows:
                    csvRows += rows.Rows.Count;

                    // El nombre del archivo no trae el esquema, así que solo se
                    // añade si el guion no nombró ya esa tabla: si no, la misma
                    // tabla saldría dos veces con dos nombres.
                    if (!tables.Exists(name => Matches(name, rows.Table)) && seen.Add(rows.Table))
                    {
                        tables.Add(rows.Table);
                    }

                    break;
            }
        }

        return new ArchiveSummary(
            archive.Layout,
            archive.Compressed,
            manifest,
            statements,
            csvRows,
            tables);
    }

    /// <summary>Si un `esquema.tabla` y un nombre suelto hablan de lo mismo.</summary>
    private static bool Matches(string qualified, string name) =>
        string.Equals(qualified, name, StringComparison.OrdinalIgnoreCase) ||
        qualified.EndsWith($".{name}", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Las tablas del artefacto que ya existen en el destino, con sus filas.
    ///
    /// Se leen del catálogo y no se pregunta tabla a tabla: son dos lecturas del
    /// árbol frente a una consulta por nombre, y el árbol ya está cacheado.
    /// </summary>
    private async Task<CollisionReport> CollisionsAsync(
        Guid sessionId,
        IReadOnlyList<string> tables,
        CancellationToken cancellationToken)
    {
        if (tables.Count == 0)
        {
            return new CollisionReport([], Known: true);
        }

        var existing = new Dictionary<string, DatabaseObject>(StringComparer.OrdinalIgnoreCase);

        try
        {
            using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

            var session = _connections.Require(sessionId);

            foreach (var table in await TablesAsync(session, cancellationToken))
            {
                existing[DataSelection.KeyOf(table)] = table;
            }
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Sin catálogo se restaura igual —no poder avisar de lo que se
            // sobrescribe no es motivo para impedirlo— pero **no se dice que no
            // haya nada**: una lista vacía y «no se pudo mirar» se leen igual en
            // la pantalla, y solo una de las dos es cierta.
            return new CollisionReport([], Known: false);
        }

        // Se empareja con la misma tolerancia que al meter datos: el artefacto
        // puede nombrar la tabla sin esquema —lo hace MySQL, donde el esquema es
        // la base y no viaja con el respaldo— y aun así estar hablando de una que
        // ya existe aquí. Compararlo por clave exacta diría «no hay nada que
        // sobrescribir» justo antes de sobrescribirlo.
        return new CollisionReport(
            [
                .. tables
                    .Select(table => (Name: table, Match: existing.Values.FirstOrDefault(
                        candidate => Matches(DataSelection.KeyOf(candidate), table))))
                    .Where(pair => pair.Match is not null)
                    .Select(pair => new RestoreCollision(
                        pair.Name,
                        pair.Match!.ApproximateRowCount)),
            ],
            Known: true);
    }

    /// <summary>
    /// Qué se va a sobrescribir, **y si se pudo saber**.
    ///
    /// Las dos cosas viajan juntas porque separadas se confunden: una lista vacía
    /// puede significar «no hay nada que pisar» o «no se pudo mirar el catálogo»,
    /// y quien decide restaurar sobre una base de verdad necesita saber cuál de
    /// las dos es.
    /// </summary>
    private readonly record struct CollisionReport(
        IReadOnlyList<RestoreCollision> Collisions,
        bool Known);

    /// <summary>Hasta dónde se baja por el árbol buscando tablas.</summary>
    private const int MaxDepth = 6;

    /// <summary>
    /// Las tablas que hoy tiene la base de la sesión.
    ///
    /// Se pide por el mismo camino que el explorador y no con una consulta al
    /// catálogo escrita aquí: es lo que ya sabe hacerlo en los cuatro motores, y
    /// una segunda forma de listar tablas sería una segunda forma de que se
    /// escapen las vistas.
    ///
    /// Se habla con el lector directamente, sin pasar por `MetadataService`:
    /// **quien llama ya tiene el turno de la sesión**, y volver a pedirlo sería
    /// esperarse a uno mismo para siempre.
    /// </summary>
    private async Task<IReadOnlyList<DatabaseObject>> TablesAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        var reader = _providers.GetMetadataReader(session.Engine);
        var databases = await reader.GetDatabasesAsync(session, cancellationToken);

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

        return await UnderAsync(session, reader, current, 0, cancellationToken);
    }

    private async Task<IReadOnlyList<DatabaseObject>> UnderAsync(
        IDatabaseSession session,
        IDatabaseMetadataReader reader,
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

        var database = parent.Kind == DatabaseObjectKind.Database
            ? parent.Database ?? parent.Name
            : parent.Database;

        var children = await _connections.UseDatabaseAsync(
            session,
            database,
            selected => reader.GetChildrenAsync(selected, parent, cancellationToken),
            cancellationToken);

        var found = new List<DatabaseObject>();

        foreach (var child in children)
        {
            if (child.Kind == DatabaseObjectKind.Table)
            {
                found.Add(child);
                continue;
            }

            if (child.Kind is DatabaseObjectKind.Folder or DatabaseObjectKind.Schema)
            {
                found.AddRange(await UnderAsync(session, reader, child, depth + 1, cancellationToken));
            }
        }

        return found;
    }

    /// <summary>
    /// Lo que se va sabiendo del destino mientras se restaura.
    ///
    /// Vive en una instancia por restauración y no en el servicio: el catálogo se
    /// lee **después** de crear las tablas, y guardarlo entre restauraciones
    /// serviría el de la anterior.
    /// </summary>
    private sealed class RestoreTargets
    {
        /// <summary>Tablas del destino, leídas la primera vez que hacen falta.</summary>
        public IReadOnlyList<DatabaseObject>? Tables { get; set; }

        public Dictionary<string, IReadOnlyList<DatabaseColumn>> Columns { get; } =
            new(StringComparer.OrdinalIgnoreCase);

        /// <summary>Tabla a la que se le abrió paso para escribirle la identidad.</summary>
        public ScriptedTable? Loading { get; set; }
    }

    /// <summary>
    /// Mete un lote de filas de un CSV en su tabla.
    ///
    /// Es el camino de la importación —emparejar columnas por nombre, convertir
    /// cada celda al tipo de la suya y escribir con parámetros—, y por eso los
    /// valores no se pegan dentro de un `INSERT`: un respaldo puede traer texto
    /// con comillas, y ahí no hay nada que analizar, solo que insertar.
    /// </summary>
    private async Task<long> LoadAsync(
        IDatabaseSession session,
        IDatabaseScripter scripter,
        RestoreTargets targets,
        BackupRows data,
        RestoreState state,
        CancellationToken cancellationToken)
    {
        var table = await ResolveAsync(session, targets, data.Table, cancellationToken);
        var columns = await ColumnsAsync(session, targets, table, cancellationToken);
        var mapped = RowBatchPlanner.Match(data.Columns, columns);

        if (!mapped.Any(column => column is not null))
        {
            throw new InvalidOperationException(
                $"Ninguna columna de «{data.Source}» existe en la tabla {DataSelection.KeyOf(table)}.");
        }

        // Una columna del archivo que no está en el destino se queda fuera, pero
        // no en silencio: son datos del respaldo que no van a entrar.
        if (data.FirstRow == 1 && mapped.Any(column => column is null))
        {
            var perdidas = data.Columns.Where((_, index) => mapped[index] is null);

            state.Warn(
                data.Table,
                $"La tabla del destino no tiene {string.Join(", ", perdidas.Select(name => $"«{name}»"))}: " +
                "esas columnas del respaldo no se restauran.");
        }

        var plan = RowBatchPlanner.Prepare(
            table.Schema,
            table.Name,
            mapped,
            data.Rows,
            data.FirstRow);

        // Aquí no se anota y se sigue, como al importar: esto es una restauración,
        // y meter las filas que sí caben después de una que no deja una tabla que
        // nadie sabe describir.
        if (plan.Problems.Count > 0)
        {
            var problem = plan.Problems[0];

            throw new InvalidOperationException(
                $"Fila {problem.Row} de «{data.Source}», columna «{problem.Column}»: {problem.Message}");
        }

        await OpenLoadAsync(session, scripter, targets, table, columns, cancellationToken);

        var result = await _providers
            .GetRowEditor(session.Engine)
            .InsertAsync(session, plan.Batch, cancellationToken);

        return result.RowsAffected;
    }

    /// <summary>
    /// A qué tabla del destino van los datos de un archivo.
    ///
    /// Los artefactos de esta versión nombran el archivo con su esquema, así que
    /// primero se busca esa tabla exacta. Los anteriores lo nombraban solo con la
    /// tabla, y por eso queda la segunda pasada: se prueba con el nombre corto, y
    /// si vale para dos no se elige una —insertar en la equivocada es peor que
    /// parar—.
    ///
    /// La segunda pasada sirve además para lo que la función existe: restaurar en
    /// otro sitio. Un respaldo de `ventas.clientes` puede ir a una base donde esa
    /// tabla vive en `public`, y exigir el esquema de origen lo impediría.
    /// </summary>
    private async Task<DatabaseObject> ResolveAsync(
        IDatabaseSession session,
        RestoreTargets targets,
        string name,
        CancellationToken cancellationToken)
    {
        targets.Tables ??= await TablesAsync(session, cancellationToken);

        var candidates = Candidates(targets.Tables, name);

        // El nombre corto solo entra cuando el cualificado no encontró nada: si
        // el destino tiene la tabla en su esquema, esa gana sin ambigüedad.
        if (candidates.Count == 0 && name.LastIndexOf('.') is var cut && cut > 0)
        {
            candidates = Candidates(targets.Tables, name[(cut + 1)..]);
        }

        return candidates.Count switch
        {
            1 => candidates[0],
            0 => throw new InvalidOperationException(
                $"El respaldo trae datos para «{name}», que no existe en el destino."),
            _ => throw new InvalidOperationException(
                $"El respaldo trae datos para «{name}» y el destino tiene esa tabla en " +
                $"{candidates.Count} esquemas ({string.Join(", ", candidates.Select(DataSelection.KeyOf))}). " +
                "El archivo de datos no dice en cuál va."),
        };
    }

    private static List<DatabaseObject> Candidates(
        IReadOnlyList<DatabaseObject> tables,
        string name) =>
        [.. tables.Where(table => Matches(DataSelection.KeyOf(table), name) ||
                                  string.Equals(table.Name, name, StringComparison.OrdinalIgnoreCase))];

    private async Task<IReadOnlyList<DatabaseColumn>> ColumnsAsync(
        IDatabaseSession session,
        RestoreTargets targets,
        DatabaseObject table,
        CancellationToken cancellationToken)
    {
        var key = DataSelection.KeyOf(table);

        if (targets.Columns.TryGetValue(key, out var cached))
        {
            return cached;
        }

        var reader = _providers.GetMetadataReader(session.Engine);

        var columns = await _connections.UseDatabaseAsync(
            session,
            table.Database,
            selected => reader.GetColumnsAsync(selected, table, cancellationToken),
            cancellationToken);

        targets.Columns[key] = columns;

        return columns;
    }

    /// <summary>
    /// Abre paso para escribir en las columnas que genera el motor.
    ///
    /// Es lo que el guion escribe alrededor de sus `INSERT`; con los datos en CSV
    /// no hay guion, así que lo emite quien restaura. Va tabla por tabla porque
    /// `IDENTITY_INSERT` es de la sesión y SQL Server solo admite una abierta a
    /// la vez.
    /// </summary>
    private static async Task OpenLoadAsync(
        IDatabaseSession session,
        IDatabaseScripter scripter,
        RestoreTargets targets,
        DatabaseObject table,
        IReadOnlyList<DatabaseColumn> columns,
        CancellationToken cancellationToken)
    {
        if (targets.Loading is { } open &&
            string.Equals(
                DataSelection.KeyOf(open.Table),
                DataSelection.KeyOf(table),
                StringComparison.OrdinalIgnoreCase))
        {
            return;
        }

        await CloseLoadAsync(session, scripter, targets, cancellationToken);

        var scripted = new ScriptedTable
        {
            Table = table,
            Columns = columns,
            Structure = new TableStructure(),
        };

        foreach (var statement in scripter.BeginDataLoad(scripted))
        {
            await scripter.ApplyAsync(session, statement, cancellationToken);
        }

        targets.Loading = scripted;
    }

    private static async Task CloseLoadAsync(
        IDatabaseSession session,
        IDatabaseScripter scripter,
        RestoreTargets targets,
        CancellationToken cancellationToken)
    {
        if (targets.Loading is not { } open)
        {
            return;
        }

        targets.Loading = null;

        foreach (var statement in scripter.EndDataLoad(open))
        {
            await scripter.ApplyAsync(session, statement, cancellationToken);
        }
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

        /// <summary>
        /// Algo que no impide seguir pero que hay que contar al terminar.
        ///
        /// Se publica en el acto: quien mira una restauración de media hora quiere
        /// enterarse de que una columna se quedó fuera cuando pasa, no al final.
        /// </summary>
        public void Warn(string subject, string message)
        {
            _warnings.Add(new BackupWarning(subject, message));
            Publish();
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
