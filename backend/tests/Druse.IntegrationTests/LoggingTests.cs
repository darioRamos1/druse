using System.IO.Compression;

using Druse.Host.LocalApi.Diagnostics;
using Druse.Platform.Abstractions;

using Microsoft.Extensions.Logging;

namespace Druse.IntegrationTests;

/// <summary>
/// Lo que se escribe en el registro local, que es lo que alguien puede acabar
/// mandando por correo cuando algo falla.
/// </summary>
public sealed class LogRedactionTests
{
    /// <summary>
    /// El caso que motiva todo esto: **los drivers ponen la cadena de conexión
    /// entera en sus mensajes de error**, y ahí va la contraseña. Druse no la
    /// escribe a propósito; llega dentro de una excepción.
    /// </summary>
    [Theory]
    [InlineData("Host=srv;Username=ana;Password=secreta-de-verdad;Database=ventas")]
    [InlineData("Server=srv;Uid=ana;Pwd=secreta-de-verdad;")]
    [InlineData("Login failed. Password=secreta-de-verdad")]
    public void LaContrasenaNoLlegaAlArchivo(string mensaje)
    {
        var limpio = LogRedaction.Clean(mensaje);

        Assert.DoesNotContain("secreta-de-verdad", limpio, StringComparison.Ordinal);

        // Pero sigue diciendo qué se quitó: un registro que borra sin decirlo se
        // lee como si el dato no hubiera estado.
        Assert.Contains("···", limpio, StringComparison.Ordinal);
    }

    /// <summary>
    /// El token de la API local abre sesiones contra las bases del usuario. No
    /// puede quedar en un archivo de texto.
    /// </summary>
    [Fact]
    public void ElTokenDeLaApiNoLlegaAlArchivo()
    {
        const string Token = "BIOFlNYJfw7s7mzmOx5RK1OR1xVN8KrOKcIvMntOdw=";

        var limpio = LogRedaction.Clean($"Cabecera X-Druse-Token: {Token}");

        Assert.DoesNotContain(Token, limpio, StringComparison.Ordinal);
    }

    /// <summary>
    /// Y lo que no es un secreto se queda: un filtro que borra de más deja un
    /// registro que no sirve para nada, que es la otra forma de fallar.
    /// </summary>
    [Fact]
    public void LoQueNoEsUnSecretoSigueLegible()
    {
        const string Mensaje = "El respaldo 4f2a terminó con 3 avisos en 12 s";

        Assert.Equal(Mensaje, LogRedaction.Clean(Mensaje));
    }
}

/// <summary>
/// Rutas dentro de un directorio temporal: el registro no puede escribirse en el
/// de verdad mientras se prueba.
/// </summary>
internal sealed class TemporaryLogPaths : IAppPaths, IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"druse-log-{Guid.NewGuid():N}");

    public string DataDirectory => _root;
    public string ConfigDirectory => _root;
    public string CacheDirectory => Path.Combine(_root, "cache");
    public string LogDirectory => Path.Combine(_root, "logs");
    public string DatabaseFile => Path.Combine(_root, "druse.db");

    public void EnsureCreated() => Directory.CreateDirectory(LogDirectory);

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_root))
            {
                Directory.Delete(_root, recursive: true);
            }
        }
        catch (IOException)
        {
            // Está en el directorio temporal del sistema; no importa.
        }
    }
}

/// <summary>
/// El archivo de registro: que se escriba, que no crezca sin fin y que no se lo
/// coma entero un proceso que lleva meses abierto.
/// </summary>
public sealed class FileLoggerTests : IDisposable
{
    private readonly TemporaryLogPaths _paths = new();

    public FileLoggerTests() => _paths.EnsureCreated();

    public void Dispose() => _paths.Dispose();

    private string[] Files() =>
        Directory.Exists(_paths.LogDirectory)
            ? [.. Directory.GetFiles(_paths.LogDirectory, "druse*.log").Order(StringComparer.Ordinal)]
            : [];

    [Fact]
    public void LoQueSeRegistraTerminaEnElArchivo()
    {
        using (var provider = new FileLoggerProvider(_paths, new FileLogOptions()))
        {
            provider.CreateLogger("Druse.Prueba").LogInformation("El respaldo terminó");
        }

        var texto = File.ReadAllText(Path.Combine(_paths.LogDirectory, "druse.log"));

        Assert.Contains("El respaldo terminó", texto, StringComparison.Ordinal);
        Assert.Contains("INF", texto, StringComparison.Ordinal);
        Assert.Contains("Druse.Prueba", texto, StringComparison.Ordinal);
    }

    /// <summary>
    /// La contraseña no llega al archivo aunque venga dentro del mensaje: la
    /// limpieza no es una opción del registro, es su único camino.
    /// </summary>
    [Fact]
    public void UnMensajeConCredencialesSeGuardaSaneado()
    {
        using (var provider = new FileLoggerProvider(_paths, new FileLogOptions()))
        {
            provider.CreateLogger("Druse.Prueba").LogError(
                "No se pudo abrir Host=srv;Password=secreta-de-verdad;");
        }

        var texto = File.ReadAllText(Path.Combine(_paths.LogDirectory, "druse.log"));

        Assert.DoesNotContain("secreta-de-verdad", texto, StringComparison.Ordinal);
    }

    /// <summary>
    /// Un proceso que alguien deja abierto meses no puede llenarle el disco. Se
    /// rota por tamaño y se conservan unos pocos.
    /// </summary>
    [Fact]
    public void AlLlenarseElArchivoSeAbreOtroYLosViejosSeVan()
    {
        var options = new FileLogOptions { MaxBytes = 512, MaxFiles = 3 };

        using (var provider = new FileLoggerProvider(_paths, options))
        {
            var logger = provider.CreateLogger("Druse.Prueba");

            for (var linea = 0; linea < 200; linea++)
            {
                // Con la comprobación delante porque el analizador la exige: aquí
                // el nivel está habilitado siempre, pero la regla vale igual.
                if (logger.IsEnabled(LogLevel.Information))
                {
                    logger.LogInformation(
                        "Una línea larga de registro para llenar el archivo {Linea}",
                        linea);
                }
            }
        }

        var files = Files();

        // El que está abierto más los conservados, y ni uno más.
        Assert.Equal(3, files.Length);
        Assert.All(files, file => Assert.True(
            new FileInfo(file).Length < 4 * options.MaxBytes,
            $"{Path.GetFileName(file)} creció más de lo permitido."));
    }

    /// <summary>
    /// Por debajo del nivel configurado no se escribe: un registro con todo
    /// dentro es un registro que nadie lee.
    /// </summary>
    [Fact]
    public void LoQueEstaPorDebajoDelNivelNoSeEscribe()
    {
        using (var provider = new FileLoggerProvider(
            _paths,
            new FileLogOptions { MinimumLevel = LogLevel.Warning }))
        {
            var logger = provider.CreateLogger("Druse.Prueba");

            logger.LogInformation("esto no");
            logger.LogWarning("esto sí");
        }

        var texto = File.ReadAllText(Path.Combine(_paths.LogDirectory, "druse.log"));

        Assert.DoesNotContain("esto no", texto, StringComparison.Ordinal);
        Assert.Contains("esto sí", texto, StringComparison.Ordinal);
    }

    /// <summary>
    /// Cada línea dice de qué operación es. Sin eso, un respaldo y una consulta a
    /// la vez dejan un registro que no se puede separar.
    /// </summary>
    [Fact]
    public void CadaLineaLlevaElIdentificadorDeSuOperacion()
    {
        using (var provider = new FileLoggerProvider(_paths, new FileLogOptions()))
        {
            var logger = provider.CreateLogger("Druse.Prueba");

            using (logger.BeginScope(new Dictionary<string, object?> { ["JobId"] = "job-7" }))
            {
                logger.LogInformation("escribiendo tablas");
            }

            logger.LogInformation("fuera del trabajo");
        }

        var lineas = File.ReadAllLines(Path.Combine(_paths.LogDirectory, "druse.log"));

        Assert.Contains(lineas, line => line.Contains("[JobId=job-7]", StringComparison.Ordinal)
            && line.Contains("escribiendo tablas", StringComparison.Ordinal));

        Assert.Contains(lineas, line => line.Contains("fuera del trabajo", StringComparison.Ordinal)
            && !line.Contains("JobId", StringComparison.Ordinal));
    }
}

/// <summary>
/// El paquete que se manda cuando algo falla.
///
/// Lo importante no es solo que se genere, sino **qué lleva dentro**: si hubiera
/// que revisarlo antes de mandarlo, no lo mandaría nadie.
/// </summary>
public sealed class DiagnosticPackageTests : IDisposable
{
    private readonly TemporaryLogPaths _paths = new();

    public DiagnosticPackageTests() => _paths.EnsureCreated();

    public void Dispose() => _paths.Dispose();

    private static Dictionary<string, string> Abrir(byte[] paquete)
    {
        using var stream = new MemoryStream(paquete);
        using var zip = new ZipArchive(stream, ZipArchiveMode.Read);

        var contenido = new Dictionary<string, string>(StringComparer.Ordinal);

        foreach (var entry in zip.Entries)
        {
            using var reader = new StreamReader(entry.Open());

            contenido[entry.FullName] = reader.ReadToEnd();
        }

        return contenido;
    }

    [Fact]
    public void ElPaqueteLlevaElResumenYLosRegistros()
    {
        using (var provider = new FileLoggerProvider(_paths, new FileLogOptions()))
        {
            provider.CreateLogger("Druse.Prueba").LogWarning("algo que mirar");
        }

        var contenido = Abrir(DiagnosticPackage.Build(_paths, "Production"));

        Assert.Contains("resumen.txt", contenido.Keys, StringComparer.Ordinal);
        Assert.Contains("logs/druse.log", contenido.Keys, StringComparer.Ordinal);
        Assert.Contains("algo que mirar", contenido["logs/druse.log"], StringComparison.Ordinal);

        // Lo que se pregunta al recibir un fallo: qué versión y qué sistema.
        Assert.Contains("Versión:", contenido["resumen.txt"], StringComparison.Ordinal);
        Assert.Contains("Sistema:", contenido["resumen.txt"], StringComparison.Ordinal);
    }

    /// <summary>
    /// El registro está abierto por el propio proceso que escribe: leerlo para
    /// empaquetarlo no puede fallar justo cuando alguien intenta contar un
    /// problema.
    /// </summary>
    [Fact]
    public void SePuedeEmpaquetarConElRegistroAbierto()
    {
        using var provider = new FileLoggerProvider(_paths, new FileLogOptions());

        provider.CreateLogger("Druse.Prueba").LogError("mientras se escribe");

        var contenido = Abrir(DiagnosticPackage.Build(_paths, "Production"));

        Assert.Contains("mientras se escribe", contenido["logs/druse.log"], StringComparison.Ordinal);
    }

    [Fact]
    public void SinRegistrosElPaqueteSigueSiendoUtil()
    {
        var contenido = Abrir(DiagnosticPackage.Build(_paths, "Production"));

        Assert.Single(contenido);
        Assert.Contains("resumen.txt", contenido.Keys, StringComparer.Ordinal);
    }
}
