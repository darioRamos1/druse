namespace Druse.Application.Connections;

/// <summary>
/// A qué base se conecta Druse cuando el perfil no dice ninguna.
///
/// La regla es la que espera quien abre una conexión: **la primera a la que tenga
/// acceso**, dejando para el final las del propio motor. El catálogo ya devuelve
/// solo las que el usuario puede abrir —`has_database_privilege` en PostgreSQL,
/// `HAS_DBACCESS` en SQL Server—, así que aquí no se comprueban permisos: se
/// elige.
///
/// Vive aparte del servicio porque es una decisión con casos —ninguna base, solo
/// bases del motor, mayúsculas distintas— y son justo los que no se ven al
/// probarlo a mano contra un servidor que tiene de todo.
/// </summary>
public static class DatabaseChoice
{
    /// <summary>
    /// La base elegida, o `null` cuando no hay ninguna donde elegir.
    /// </summary>
    /// <param name="databases">Las que el usuario puede abrir, en el orden del catálogo.</param>
    /// <param name="system">Las del propio motor, que se dejan para el final.</param>
    public static string? Pick(IReadOnlyList<string> databases, IReadOnlyList<string> system)
    {
        ArgumentNullException.ThrowIfNull(databases);
        ArgumentNullException.ThrowIfNull(system);

        var propias = databases.Where(database =>
            !string.IsNullOrWhiteSpace(database) &&
            !system.Contains(database, StringComparer.OrdinalIgnoreCase));

        // Si solo hay bases del motor se usa una de ellas: conectar a `master` y
        // ver el explorador es mejor que negarse a abrir la conexión.
        return propias.FirstOrDefault()
            ?? databases.FirstOrDefault(database => !string.IsNullOrWhiteSpace(database));
    }
}
