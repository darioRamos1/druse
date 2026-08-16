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

    /// <summary>
    /// Índices, claves foráneas y demás restricciones de una tabla.
    ///
    /// Va en una sola llamada porque una conexión no ejecuta dos cosas a la vez:
    /// pedirlo por partes serían cuatro turnos seguidos sobre la misma sesión.
    /// </summary>
    Task<TableStructure> GetTableStructureAsync(
        IDatabaseSession session,
        DatabaseObject table,
        CancellationToken cancellationToken);

    /// <summary>
    /// Parámetros de un procedimiento o función, para poder componer la llamada.
    ///
    /// Se lee del catálogo y no del DDL: el texto de creación lo puede haber
    /// perdido el motor, viene en el dialecto de cada uno y habría que
    /// interpretarlo para saber qué entra y qué sale.
    /// </summary>
    Task<RoutineSignature> GetRoutineSignatureAsync(
        IDatabaseSession session,
        DatabaseObject routine,
        CancellationToken cancellationToken);
}
