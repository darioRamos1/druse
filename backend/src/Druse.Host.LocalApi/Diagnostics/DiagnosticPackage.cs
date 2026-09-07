using System.Globalization;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;

using Druse.Platform.Abstractions;

namespace Druse.Host.LocalApi.Diagnostics;

/// <summary>
/// Junta lo que hace falta para entender un fallo, en un archivo que se puede
/// mandar.
///
/// Existe por lo mismo que el registro en archivo: **en la aplicación empaquetada
/// no hay consola**, y pedirle a alguien que busque a mano un directorio de
/// registros dentro de su perfil es pedirle que no lo haga. Esto es un botón.
///
/// **Lo que lleva dentro está pensado para poder enseñarlo.** Los registros ya
/// van saneados —de eso se encarga <see cref="LogRedaction"/> al escribirlos— y
/// el resumen dice qué versión, qué sistema y qué motores hay, no qué bases se
/// abren ni con qué credenciales. Un paquete que hubiera que revisar antes de
/// mandarlo no lo mandaría nadie.
/// </summary>
public static class DiagnosticPackage
{
    /// <summary>Cómo se llama el archivo que se descarga.</summary>
    public static string FileName =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"druse-diagnostico-{DateTimeOffset.Now:yyyyMMdd-HHmm}.zip");

    /// <summary>El paquete entero, ya en memoria.</summary>
    /// <remarks>
    /// Cabe en memoria a propósito: los registros están limitados por tamaño y
    /// número, así que lo que puede llegar aquí está acotado por construcción.
    /// </remarks>
    public static byte[] Build(IAppPaths paths, string environment)
    {
        ArgumentNullException.ThrowIfNull(paths);

        var salida = new MemoryStream();

        using (var zip = new ZipArchive(salida, ZipArchiveMode.Create, leaveOpen: true))
        {
            Write(zip, "resumen.txt", Summary(paths, environment));

            foreach (var log in Logs(paths))
            {
                // Se copia el contenido en vez de meter el archivo: está abierto
                // por el propio proceso que escribe los registros.
                Write(zip, $"logs/{Path.GetFileName(log)}", Read(log));
            }
        }

        return salida.ToArray();
    }

    private static IEnumerable<string> Logs(IAppPaths paths) =>
        Directory.Exists(paths.LogDirectory)
            ? Directory.EnumerateFiles(paths.LogDirectory, "druse*.log").Order(StringComparer.Ordinal)
            : [];

    /// <summary>
    /// Lee un registro que **está abierto por este mismo proceso**.
    ///
    /// De ahí el `FileShare.ReadWrite`: sin él, leer el archivo en el que se está
    /// escribiendo falla, y justo cuando alguien intenta contar un problema.
    /// </summary>
    private static string Read(string path)
    {
        try
        {
            using var stream = new FileStream(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite | FileShare.Delete);

            using var reader = new StreamReader(stream);

            return reader.ReadToEnd();
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return $"(no se pudo leer: {error.Message})";
        }
    }

    /// <summary>
    /// Lo que hay que saber antes de mirar un registro: qué versión, dónde y sobre
    /// qué.
    ///
    /// Ni una ruta del usuario más allá de las de la propia aplicación, ni nombres
    /// de bases, ni de servidores. Lo que se pregunta al recibir un fallo es
    /// «¿qué versión?» y «¿qué sistema?», y eso es lo que va.
    /// </summary>
    private static string Summary(IAppPaths paths, string environment)
    {
        var assembly = Assembly.GetExecutingAssembly().GetName();

        var lines = new List<string>
        {
            "Druse — paquete de diagnóstico",
            string.Empty,
            $"Generado:   {DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture)}",
            $"Versión:    {assembly.Version?.ToString(3) ?? "0.0.0"}",
            $"Entorno:    {environment}",
            $"Sistema:    {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture})",
            $"Runtime:    {RuntimeInformation.FrameworkDescription}",
            $"Informix:   {(IncludesInformix ? "incluido" : "no incluido")}",
            string.Empty,
            $"Registros:  {Logs(paths).Count().ToString(CultureInfo.InvariantCulture)} archivo(s)",
            $"Base local: {Size(paths.DatabaseFile)}",
            string.Empty,
            "Los registros van saneados: no llevan contraseñas, tokens ni cadenas de conexión.",
            "Tampoco llevan el SQL que se ejecuta ni los datos de las filas.",
        };

        return string.Join(Environment.NewLine, lines);
    }

    /// <summary>Si esta compilación trae el proveedor de Informix, que pesa 111 MB.</summary>
    private static bool IncludesInformix =>
#if DRUSE_INFORMIX
        true;
#else
        false;
#endif

    private static string Size(string path)
    {
        try
        {
            return File.Exists(path)
                ? string.Create(
                    CultureInfo.InvariantCulture,
                    $"{new FileInfo(path).Length / 1024} KB")
                : "(no existe)";
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            return "(no se pudo medir)";
        }
    }

    private static void Write(ZipArchive zip, string name, string content)
    {
        var entry = zip.CreateEntry(name, CompressionLevel.Optimal);

        using var stream = entry.Open();
        using var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));

        writer.Write(content);
    }
}
