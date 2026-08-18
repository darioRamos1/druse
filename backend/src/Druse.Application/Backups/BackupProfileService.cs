using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Backups;

/// <summary>
/// Perfiles de respaldo: guardarlos, y **traerlos al presente** al abrirlos.
///
/// Lo segundo es lo que justifica que exista un servicio y no solo un almacén. Un
/// perfil guarda una intención —«el esquema de ventas y estas tres tablas»— y la
/// base cambia debajo: se borran tablas, aparecen otras, alguien renombra un
/// esquema. Resolverlo es leer el catálogo de hoy y decir en qué se ha convertido
/// aquello, sin negarse a abrirlo y sin fingir que nada ha cambiado.
/// </summary>
public sealed class BackupProfileService(
    IBackupProfileStore profiles,
    IProviderRegistry providers,
    ConnectionService connections)
{
    private readonly IBackupProfileStore _profiles = profiles;
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;

    public Task<IReadOnlyList<BackupProfile>> GetAllAsync(CancellationToken cancellationToken) =>
        _profiles.GetAllAsync(cancellationToken);

    public Task<BackupProfile?> FindAsync(Guid id, CancellationToken cancellationToken) =>
        _profiles.FindAsync(id, cancellationToken);

    public Task SaveAsync(BackupProfile profile, CancellationToken cancellationToken) =>
        _profiles.SaveAsync(profile, cancellationToken);

    public Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken) =>
        _profiles.DeleteAsync(id, cancellationToken);

    public Task<bool> MarkRunAsync(Guid id, CancellationToken cancellationToken) =>
        _profiles.TouchAsync(id, DateTimeOffset.UtcNow, cancellationToken);

    /// <summary>
    /// Qué se llevaría hoy este perfil, y qué de lo que pedía ya no está.
    ///
    /// Se lee el catálogo una sola vez por esquema aunque el perfil lo nombre
    /// veinte veces: un perfil grande contra una base remota pagaría esa lectura
    /// en cada tabla, y abrirlo dejaría de ser instantáneo.
    /// </summary>
    public async Task<BackupProfileResolution> ResolveAsync(
        BackupProfile profile,
        Guid sessionId,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);
        var metadata = _providers.GetMetadataReader(session.Engine);

        var schemas = await SchemasAsync(session, metadata, cancellationToken);
        var tablesBySchema = new Dictionary<string, IReadOnlyList<DatabaseObject>>(
            StringComparer.OrdinalIgnoreCase);

        var resolved = new List<DatabaseObject>();
        var seen = new HashSet<string>(StringComparer.Ordinal);
        var gaps = new List<BackupProfileGap>();

        foreach (var selector in profile.Selection)
        {
            if (!schemas.TryGetValue(selector.Schema, out var schema))
            {
                gaps.Add(new BackupProfileGap(
                    selector,
                    $"El esquema «{selector.Schema}» ya no existe en esta base."));

                continue;
            }

            if (!tablesBySchema.TryGetValue(selector.Schema, out var tables))
            {
                tables = await TablesUnderAsync(session, metadata, schema, 0, cancellationToken);
                tablesBySchema[selector.Schema] = tables;
            }

            if (selector.Kind == BackupSelectorKind.Schema)
            {
                foreach (var table in tables)
                {
                    Add(table);
                }

                continue;
            }

            var found = tables.FirstOrDefault(table =>
                string.Equals(table.Name, selector.Name, StringComparison.OrdinalIgnoreCase));

            if (found is null)
            {
                gaps.Add(new BackupProfileGap(
                    selector,
                    $"La tabla «{selector.Label}» ya no existe."));

                continue;
            }

            Add(found);
        }

        return new BackupProfileResolution
        {
            Profile = profile,
            Tables = resolved,
            Gaps = gaps,
            Added = Added(profile, resolved),
        };

        // Una tabla puede llegar por su esquema y otra vez por su nombre: se
        // respalda una sola vez, y la primera aparición manda para el orden.
        void Add(DatabaseObject table)
        {
            if (seen.Add(DataSelection.KeyOf(table)))
            {
                resolved.Add(table);
            }
        }
    }

    /// <summary>
    /// Lo que hay hoy y no estaba la última vez que se guardó.
    ///
    /// Solo se dice cuando el perfil trae memoria: uno recién creado no ha
    /// «crecido», y anunciar sus veinte tablas como novedades sería ruido en el
    /// único momento en que el usuario ya sabe exactamente qué eligió.
    /// </summary>
    private static IReadOnlyList<string> Added(
        BackupProfile profile,
        IReadOnlyList<DatabaseObject> resolved)
    {
        if (profile.KnownTables.Count == 0)
        {
            return [];
        }

        var known = new HashSet<string>(profile.KnownTables, StringComparer.OrdinalIgnoreCase);

        return [.. resolved.Select(DataSelection.KeyOf).Where(key => !known.Contains(key))];
    }

    /// <summary>Los esquemas de la base en curso, por nombre.</summary>
    private static async Task<Dictionary<string, DatabaseObject>> SchemasAsync(
        IDatabaseSession session,
        IDatabaseMetadataReader metadata,
        CancellationToken cancellationToken)
    {
        var schemas = new Dictionary<string, DatabaseObject>(StringComparer.OrdinalIgnoreCase);

        // Se parte de la base abierta y no de la lista entera del servidor: un
        // perfil se resuelve contra la conexión que se le dé, y buscar sus
        // esquemas en otra base sería resolverlo contra algo que nadie pidió.
        var databases = await metadata.GetDatabasesAsync(session, cancellationToken);

        if (databases.Count == 0)
        {
            return schemas;
        }

        var current = databases.FirstOrDefault(database =>
            string.Equals(database.Name, session.Profile.Database, StringComparison.OrdinalIgnoreCase))
            ?? databases[0];

        foreach (var child in await metadata.GetChildrenAsync(session, current, cancellationToken))
        {
            if (child.Kind == DatabaseObjectKind.Schema)
            {
                schemas[child.Name] = child;
            }
        }

        return schemas;
    }

    /// <summary>Hasta dónde se baja buscando tablas, con margen sobre el árbol real.</summary>
    private const int MaxDepth = 6;

    /// <summary>
    /// Las tablas que cuelgan de un nodo, bajando por sus carpetas.
    ///
    /// Se recorren las carpetas en vez de buscar la que se llame «Tables»: el
    /// nombre lo pone cada proveedor y traducirlo aquí sería inventar un contrato
    /// que no existe. El tope de profundidad está por si un catálogo devolviera
    /// un hijo igual a su padre.
    /// </summary>
    private static async Task<IReadOnlyList<DatabaseObject>> TablesUnderAsync(
        IDatabaseSession session,
        IDatabaseMetadataReader metadata,
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

        foreach (var child in await metadata.GetChildrenAsync(session, parent, cancellationToken))
        {
            if (child.Kind == DatabaseObjectKind.Table)
            {
                found.Add(child);
                continue;
            }

            // Vistas y rutinas no entran todavía: solo se sabe guionizar tablas.
            if (child.Kind is DatabaseObjectKind.Folder or DatabaseObjectKind.Schema)
            {
                found.AddRange(
                    await TablesUnderAsync(session, metadata, child, depth + 1, cancellationToken));
            }
        }

        return found;
    }
}
