using Druse.Domain;
using Druse.Provider.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// La cadena de conexión de SQLite, que es la más corta de los seis y la que
/// esconde la decisión más importante: **abrir no crea**.
///
/// El valor de fábrica del driver crea el archivo si no está, así que una ruta
/// mal escrita dejaría una base vacía en el disco y una conexión que «funciona».
/// Es una línea que se cambia sin querer, y ninguna prueba de las que hay la
/// vería: el proveedor seguiría conectando igual de bien.
/// </summary>
public sealed class SqliteConnectionStringTests
{
    private static ConnectionProfile Profile() => new()
    {
        Id = Guid.NewGuid(),
        Name = "Archivo de pruebas",
        Engine = DatabaseEngine.Sqlite,

        // Vacíos porque aquí no hay servidor ni identidad: el perfil los exige
        // para los otros cinco motores, y un archivo no tiene a quién saludar.
        Host = string.Empty,
        Port = 0,
        Username = string.Empty,

        // En SQLite el archivo **es** la base, así que la ruta va donde los demás
        // motores guardan el nombre.
        Database = @"C:\datos\ventas.db",
        ConnectTimeoutSeconds = 12,
    };

    [Fact]
    public void LaRutaDelPerfilEsElOrigenDeDatos()
    {
        var connectionString = SqliteConnectionStringFactory.Build(Profile());

        Assert.Contains(@"C:\datos\ventas.db", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// La prueba que sujeta la decisión: abrir un archivo que no existe tiene que
    /// decirlo, no dejar una base vacía donde el usuario se equivocó al escribir.
    /// </summary>
    [Fact]
    public void AbrirNoCreaElArchivo()
    {
        var connectionString = SqliteConnectionStringFactory.Build(Profile());

        Assert.Contains("Mode=ReadWrite", connectionString, StringComparison.Ordinal);
        Assert.DoesNotContain("ReadWriteCreate", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// Solo lectura aquí no es una promesa de Druse sino del motor: el archivo se
    /// abre sin permiso de escritura y no hay instrucción que pueda tocarlo.
    /// </summary>
    [Fact]
    public void SoloLecturaSePideAlMotor()
    {
        var connectionString = SqliteConnectionStringFactory.Build(Profile() with { ReadOnly = true });

        Assert.Contains("Mode=ReadOnly", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// Crear es otra intención, y va por otro sitio para que no se puedan
    /// confundir por un valor por omisión.
    /// </summary>
    [Fact]
    public void CrearEsLoContrarioYSeDiceAparte()
    {
        var connectionString = SqliteConnectionStringFactory.BuildForCreate(Profile());

        Assert.Contains("Mode=ReadWriteCreate", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// Crear una base de solo lectura no significa nada, y el perfil podría venir
    /// marcado: lo que manda es la intención de crear.
    /// </summary>
    [Fact]
    public void CrearIgnoraQueElPerfilSeaDeSoloLectura()
    {
        var connectionString = SqliteConnectionStringFactory.BuildForCreate(
            Profile() with { ReadOnly = true });

        Assert.Contains("Mode=ReadWriteCreate", connectionString, StringComparison.Ordinal);
        Assert.DoesNotContain("Mode=ReadOnly", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// El caché compartido reparte una conexión entre varias, y con él dos
    /// consultas de la misma aplicación se bloquean entre sí en vez de esperar
    /// cada una lo suyo.
    /// </summary>
    [Fact]
    public void CadaConexionEsSuya()
    {
        var connectionString = SqliteConnectionStringFactory.Build(Profile());

        Assert.Contains("Cache=Private", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// SQLite admite un escritor a la vez: sin plazo, la segunda escritura falla
    /// al instante con «database is locked» en lugar de esperar su turno.
    /// </summary>
    [Fact]
    public void ElPlazoDelPerfilEsLoQueEsperaUnaEscritura()
    {
        var connectionString = SqliteConnectionStringFactory.Build(Profile());

        Assert.Contains("Default Timeout=12", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// Un plazo de cero dejaría a la segunda escritura sin esperar nada, que es
    /// justo lo que el plazo evita.
    /// </summary>
    [Fact]
    public void UnPlazoDeCeroNoDejaLaEsperaEnNada()
    {
        var connectionString = SqliteConnectionStringFactory.Build(
            Profile() with { ConnectTimeoutSeconds = 0 });

        Assert.Contains("Default Timeout=1", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// Las opciones son para lo que Druse no contempla; lo que ya tiene campo
    /// propio no se puede pisar desde ahí.
    /// </summary>
    [Fact]
    public void LasOpcionesNoPuedenCambiarElArchivoNiElModo()
    {
        var profile = Profile() with
        {
            Options = new Dictionary<string, string>
            {
                ["Data Source"] = @"C:\otro\sitio.db",
                ["Mode"] = "ReadWriteCreate",
            },
        };

        var connectionString = SqliteConnectionStringFactory.Build(profile);

        Assert.Contains(@"C:\datos\ventas.db", connectionString, StringComparison.Ordinal);
        Assert.DoesNotContain("ReadWriteCreate", connectionString, StringComparison.Ordinal);
    }
}
