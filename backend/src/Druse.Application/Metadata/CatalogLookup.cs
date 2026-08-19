using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Metadata;

/// <summary>
/// Buscar cosas en el catálogo **por su nombre**, que es como las guardan los
/// perfiles.
///
/// Un perfil —de respaldo o de migración— no puede guardar identificadores de
/// sesión ni de nodo: se reabre meses después, contra otra conexión, y esos
/// identificadores ya no significan nada. Guarda nombres, y al abrirlo hay que
/// volver a encontrar lo que nombran. Eso es lo que hay aquí.
///
/// Vive aparte porque lo necesitan dos servicios, y porque bajar por un catálogo
/// tiene más cuidados de los que parece: cada motor organiza el suyo a su manera y
/// ninguno promete la misma forma.
/// </summary>
public static class CatalogLookup
{
    /// <summary>Hasta dónde se baja buscando tablas, con margen sobre el árbol real.</summary>
    private const int MaxDepth = 6;

    /// <summary>
    /// Los esquemas de la base en curso, por nombre.
    ///
    /// Se parte de la base abierta y no de la lista entera del servidor: un perfil
    /// se resuelve contra la conexión que se le dé, y buscar sus esquemas en otra
    /// base sería resolverlo contra algo que nadie pidió.
    /// </summary>
    public static async Task<Dictionary<string, DatabaseObject>> SchemasAsync(
        IDatabaseSession session,
        IDatabaseMetadataReader metadata,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(metadata);

        var schemas = new Dictionary<string, DatabaseObject>(StringComparer.OrdinalIgnoreCase);

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

    /// <summary>
    /// Las tablas que cuelgan de un nodo, bajando por sus carpetas.
    ///
    /// Se recorren las carpetas en vez de buscar la que se llame «Tables»: el
    /// nombre lo pone cada proveedor y traducirlo aquí sería inventar un contrato
    /// que no existe. El tope de profundidad está por si un catálogo devolviera un
    /// hijo igual a su padre.
    /// </summary>
    public static Task<IReadOnlyList<DatabaseObject>> TablesUnderAsync(
        IDatabaseSession session,
        IDatabaseMetadataReader metadata,
        DatabaseObject parent,
        CancellationToken cancellationToken) =>
        TablesUnderAsync(session, metadata, parent, 0, cancellationToken);

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

            // Vistas y rutinas no entran: ni el respaldo ni el traslado saben
            // llevárselas todavía.
            if (child.Kind is DatabaseObjectKind.Folder or DatabaseObjectKind.Schema)
            {
                found.AddRange(
                    await TablesUnderAsync(session, metadata, child, depth + 1, cancellationToken));
            }
        }

        return found;
    }
}
