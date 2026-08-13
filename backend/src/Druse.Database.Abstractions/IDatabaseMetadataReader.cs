using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>
/// Lectura del catálogo de un motor.
///
/// Cada proveedor escribe sus propias consultas de metadatos. No se fuerza una
/// consulta común porque los catálogos y los dialectos no se parecen: intentar
/// unificarlos produce SQL frágil que funciona a medias en todas partes.
/// </summary>
public interface IDatabaseMetadataReader
{
    DatabaseEngine Engine { get; }

    /// <summary>Bases visibles para el usuario conectado.</summary>
    Task<IReadOnlyList<DatabaseObject>> GetDatabasesAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken);

    /// <summary>
    /// Hijos de un nodo. Es la base de la carga perezosa del explorador: nunca se
    /// devuelve el árbol entero.
    /// </summary>
    Task<IReadOnlyList<DatabaseObject>> GetChildrenAsync(
        IDatabaseSession session,
        DatabaseObject parent,
        CancellationToken cancellationToken);

    /// <summary>Columnas de una tabla o vista.</summary>
    Task<IReadOnlyList<DatabaseColumn>> GetColumnsAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken);

    /// <summary>Instrucción con la que se crea una vista o un procedimiento.</summary>
    Task<string> GetDefinitionAsync(
        IDatabaseSession session,
        DatabaseObject databaseObject,
        CancellationToken cancellationToken);
}
