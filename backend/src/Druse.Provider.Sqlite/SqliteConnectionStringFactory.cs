using Druse.Database.Abstractions;
using Druse.Domain;
using Microsoft.Data.Sqlite;

namespace Druse.Provider.Sqlite;

/// <summary>
/// Traduce un perfil neutral a una cadena de conexión de Microsoft.Data.Sqlite.
///
/// Es la más corta de los seis proveedores, y no por casualidad: aquí no hay
/// servidor, ni puerto, ni identidad, ni transporte que cifrar. Lo único que hace
/// falta es la ruta del archivo, que el perfil guarda donde los demás guardan el
/// nombre de la base — porque en SQLite **el archivo es la base**.
///
/// La cadena no lleva ningún secreto, al contrario que en los otros cinco. Aun
/// así se trata igual: sale por un solo sitio y no se registra en ninguna parte.
/// </summary>
internal static class SqliteConnectionStringFactory
{
    /// <summary>Opciones del perfil que se ignoran por venir ya en campos propios.</summary>
    private static readonly HashSet<string> ReservedKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "Data Source",
        "DataSource",
        "Mode",
    };

    public static string Build(ConnectionProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);

        var builder = new SqliteConnectionStringBuilder
        {
            DataSource = profile.Database,

            // **`ReadWrite`, no `ReadWriteCreate`.**
            //
            // El valor de fábrica del driver crea el archivo si no está, y eso
            // aquí es exactamente lo que no se quiere: una ruta mal escrita
            // dejaría una base vacía en el disco y una conexión que «funciona»,
            // en vez de decir que ese archivo no existe. Crear una base es una
            // decisión, y se toma a propósito o no se toma.
            //
            // En solo lectura se pide el modo del propio motor, que **sí es una
            // frontera**: el archivo se abre sin permiso de escritura y no hay
            // instrucción que pueda tocarlo.
            Mode = profile.ReadOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWrite,

            // Cada conexión es suya. El caché compartido reparte una sola entre
            // varias, y con él dos consultas de la misma aplicación se bloquean
            // entre sí en lugar de esperar cada una lo suyo.
            Cache = SqliteCacheMode.Private,

            // Cuánto espera una escritura a que otra termine, en milisegundos.
            // SQLite admite **un escritor a la vez**, y sin esto la segunda falla
            // al instante con «database is locked» en lugar de esperar su turno.
            DefaultTimeout = Math.Max(1, profile.ConnectTimeoutSeconds),
        };

        foreach (var (key, value) in profile.Options)
        {
            if (ReservedKeys.Contains(key))
            {
                continue;
            }

            builder[key] = value;
        }

        return builder.ConnectionString;
    }

    /// <summary>
    /// La cadena con la que se **crea** el archivo, que es otra cosa.
    ///
    /// Va aparte a propósito: abrir y crear son dos intenciones distintas y no
    /// deben poder confundirse por un valor por omisión. Quien llame a esto sabe
    /// que va a dejar algo en el disco.
    /// </summary>
    public static string BuildForCreate(ConnectionProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);

        return new SqliteConnectionStringBuilder(Build(profile with { ReadOnly = false }))
        {
            Mode = SqliteOpenMode.ReadWriteCreate,
        }.ConnectionString;
    }
}
