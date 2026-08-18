using System.Globalization;

namespace Druse.IntegrationTests;

/// <summary>
/// Un motor visto **desde la API**: lo justo para respaldar y restaurar por HTTP.
///
/// Las pruebas contractuales ya recorren los cuatro motores, pero construyen el
/// perfil directamente en el dominio. El ciclo de los respaldos entra por donde
/// entra la interfaz —`/api/sessions`, `/api/backup/run`, `/api/restore/run`— y
/// ahí el motor no es un objeto sino un identificador en un JSON, un esquema por
/// omisión que cambia de significado según el motor y dos nombres de tipo.
///
/// Es deliberadamente pequeño: lo que se prueba es el ciclo, no el dialecto.
/// Todo lo que no cambie de motor a motor no tiene sitio aquí.
/// </summary>
public sealed record RestoreEngine
{
    /// <summary>Identificador del contrato HTTP, el que viaja en el perfil.</summary>
    public required string Id { get; init; }

    /// <summary>Nombre legible, para los mensajes cuando el motor no responde.</summary>
    public required string Name { get; init; }

    public required string Host { get; init; }

    public required int Port { get; init; }

    public required string Username { get; init; }

    public required string Password { get; init; }

    /// <summary>Base de origen: de la que se respalda.</summary>
    public required string Database { get; init; }

    /// <summary>Base de destino que **ya existe**: donde se restaura encima.</summary>
    public required string SecondaryDatabase { get; init; }

    /// <summary>
    /// Esquema por omisión de una base.
    ///
    /// Es una función y no un texto porque en MySQL el esquema **es** la base:
    /// respaldar `druse_test` y restaurar en `druse_test_secondary` cambia el
    /// esquema de paso, mientras que en PostgreSQL sigue siendo `public` en las
    /// dos y en SQL Server `dbo`.
    /// </summary>
    public required Func<string, string> SchemaOf { get; init; }

    /// <summary>
    /// Cómo se borra del todo una base que la prueba creó.
    ///
    /// No basta con `DROP DATABASE IF EXISTS`: aunque la prueba cierre su sesión,
    /// el proveedor conserva la conexión en su pool y tres de los cuatro motores
    /// se niegan a borrar una base con alguien dentro. Como la limpieza se traga
    /// los errores —el fallo que importa es el de la prueba—, el `DROP` fallaba
    /// en silencio y cada ejecución dejaba una base más: así se juntaron diez
    /// `druse_nueva_*` en el contenedor de PostgreSQL.
    /// </summary>
    public required Func<string, string> DropDatabase { get; init; }

    /// <summary>Nombre del tipo entero: cada motor escribe el suyo.</summary>
    public required string NumberType { get; init; }

    /// <summary>Nombre del tipo de texto corto.</summary>
    public required string TextType { get; init; }

    /// <summary>Esquema por omisión de la base de origen.</summary>
    public string Schema => SchemaOf(Database);

    public override string ToString() => Name;
}

/// <summary>Los cuatro motores, con los mismos valores por defecto que usan las contractuales.</summary>
public static class RestoreEngines
{
    /// <summary>Identificadores para las `[Theory]`: el ciclo se prueba en los cuatro.</summary>
    public const string PostgreSql = "PostgreSql";
    public const string SqlServer = "SqlServer";
    public const string MySql = "MySql";
    public const string Informix = "Informix";

    private static string Text(string variable, string fallback) =>
        Environment.GetEnvironmentVariable(variable) is { Length: > 0 } value ? value : fallback;

    private static int Number(string variable, int fallback) =>
        int.TryParse(
            Environment.GetEnvironmentVariable(variable),
            NumberStyles.Integer,
            CultureInfo.InvariantCulture,
            out var value)
            ? value
            : fallback;

    /// <summary>El motor de un identificador de `[InlineData]`.</summary>
    public static RestoreEngine Of(string id) => id switch
    {
        PostgreSql => new RestoreEngine
        {
            Id = PostgreSql,
            Name = "PostgreSQL",
            Host = Text("DRUSE_TEST_PG_HOST", "127.0.0.1"),
            Port = Number("DRUSE_TEST_PG_PORT", 55440),
            Username = Text("DRUSE_TEST_PG_USER", "postgres"),
            Password = Text("DRUSE_TEST_PG_PASSWORD", "druse_dev_only"),
            Database = Text("DRUSE_TEST_PG_DB", "druse_test"),
            SecondaryDatabase = Text("DRUSE_TEST_PG_SECOND_DB", "druse_test_secondary"),
            SchemaOf = _ => "public",
            // PostgreSQL 13 en adelante sabe echar a quien esté dentro.
            DropDatabase = name => $"DROP DATABASE IF EXISTS {name} WITH (FORCE)",
            NumberType = "integer",
            TextType = "text",
        },

        SqlServer => new RestoreEngine
        {
            Id = SqlServer,
            Name = "SQL Server",
            Host = Text("DRUSE_TEST_MSSQL_HOST", "127.0.0.1"),
            Port = Number("DRUSE_TEST_MSSQL_PORT", 14433),
            Username = Text("DRUSE_TEST_MSSQL_USER", "sa"),
            Password = Text("DRUSE_TEST_MSSQL_PASSWORD", "Druse_dev_only_1"),
            Database = Text("DRUSE_TEST_MSSQL_DB", "druse_test"),
            SecondaryDatabase = Text("DRUSE_TEST_MSSQL_SECOND_DB", "druse_test_secondary"),
            SchemaOf = _ => "dbo",
            // Aquí hay que echarlos a mano, y solo si la base existe: el
            // `ALTER DATABASE` sobre una que no está es un error, no un no-op.
            DropDatabase = name =>
                $"IF DB_ID('{name}') IS NOT NULL BEGIN " +
                $"ALTER DATABASE [{name}] SET SINGLE_USER WITH ROLLBACK IMMEDIATE; " +
                $"DROP DATABASE [{name}]; END",
            NumberType = "int",
            TextType = "nvarchar(100)",
        },

        MySql => new RestoreEngine
        {
            Id = MySql,
            Name = "MySQL",
            Host = Text("DRUSE_TEST_MYSQL_HOST", "127.0.0.1"),
            Port = Number("DRUSE_TEST_MYSQL_PORT", 33306),
            Username = Text("DRUSE_TEST_MYSQL_USER", "root"),
            Password = Text("DRUSE_TEST_MYSQL_PASSWORD", "druse_dev_only"),
            Database = Text("DRUSE_TEST_MYSQL_DB", "druse_test"),
            SecondaryDatabase = Text("DRUSE_TEST_MYSQL_SECOND_DB", "druse_test_secondary"),
            // El esquema es la propia base: cada una es la suya.
            SchemaOf = database => database,
            // El único que no se queja de las conexiones ajenas.
            DropDatabase = name => $"DROP DATABASE IF EXISTS {name}",
            NumberType = "int",
            TextType = "varchar(100)",
        },

        Informix => new RestoreEngine
        {
            Id = Informix,
            Name = "Informix",
            Host = Text("DRUSE_TEST_IFX_HOST", "127.0.0.1"),
            // El escuchador DRDA, no el nativo: es por donde habla Druse.
            Port = Number("DRUSE_TEST_IFX_PORT", 9089),
            Username = Text("DRUSE_TEST_IFX_USER", "informix"),
            Password = Text("DRUSE_TEST_IFX_PASSWORD", "in4mix"),
            Database = Text("DRUSE_TEST_IFX_DB", "druse_test"),
            SecondaryDatabase = Text("DRUSE_TEST_IFX_SECOND_DB", "druse_test2"),
            // El esquema es el propietario de la tabla, que es el usuario conectado.
            SchemaOf = _ => Text("DRUSE_TEST_IFX_USER", "informix"),
            DropDatabase = name => $"DROP DATABASE IF EXISTS {name}",
            NumberType = "integer",
            TextType = "varchar(100)",
        },

        _ => throw new ArgumentOutOfRangeException(nameof(id), id, "Motor desconocido."),
    };
}
