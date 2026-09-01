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
    /// Columnas y estructura de varias tablas **en una sola lectura**.
    ///
    /// Es lo que hace posible un diagrama. Leer sesenta tablas con
    /// <see cref="GetColumnsAsync"/> y <see cref="GetTableStructureAsync"/> serían
    /// más de doscientos viajes contra una conexión que no admite dos cosas a la
    /// vez: no es una optimización, es la diferencia entre que la función exista
    /// o no.
    ///
    /// La implementación de aquí abajo recorre las tablas de una en una. Existe
    /// **solo para que un proveedor nuevo arranque**, y la prueba contractual que
    /// cuenta viajes la rechaza: un proveedor que se quede en ella falla, en vez
    /// de pasar desapercibido y hacer lento el diagrama.
    ///
    /// El orden de la respuesta es el de <paramref name="tables"/>. Una tabla que
    /// ya no está en el catálogo **no aparece**: entre pedir el diagrama y leerlo
    /// alguien pudo borrarla, y eso no es un error que deba tumbar la lectura de
    /// las otras cincuenta y nueve.
    /// </summary>
    async Task<IReadOnlyList<TableDetail>> GetTableDetailsAsync(
        IDatabaseSession session,
        IReadOnlyList<DatabaseObject> tables,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(tables);

        var details = new List<TableDetail>(tables.Count);

        foreach (var table in tables)
        {
            details.Add(new TableDetail
            {
                Table = table,
                Columns = await GetColumnsAsync(session, table, cancellationToken),
                Structure = await GetTableStructureAsync(session, table, cancellationToken),
            });
        }

        return details;
    }

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
