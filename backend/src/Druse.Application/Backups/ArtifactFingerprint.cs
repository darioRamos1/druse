using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace Druse.Application.Backups;

/// <summary>
/// Identifica un respaldo tal y como está ahora mismo en el disco.
///
/// Existe para una sola pregunta: **¿lo que voy a aplicar es lo que se
/// inspeccionó?** Entre mirar un artefacto y aceptar restaurarlo cabe cualquier
/// cosa —sobrescribir el archivo, dejar otro respaldo en la misma carpeta, mover
/// un `.zip` a esa ruta— y lo que se aplicaría entonces sería algo que nadie
/// aprobó, sobre una base de verdad.
///
/// **No es un hash del contenido, y se dice a propósito.** Un respaldo puede
/// ocupar gigabytes; leerlo entero otra vez para calcularlo sumaría minutos a
/// cada restauración, justo antes de la operación más lenta que hace Druse. Lo
/// que se resume es qué archivos lo forman, cuánto ocupan y cuándo se tocaron por
/// última vez, que es lo que cambia cuando el artefacto cambia.
///
/// Lo que no cubre: una edición que dejara el tamaño y la fecha exactamente como
/// estaban. Eso ya no es un descuido, es alguien haciéndolo a propósito con
/// acceso al disco del usuario, y contra eso protegen los permisos del sistema de
/// archivos, no una huella.
/// </summary>
public static class ArtifactFingerprint
{
    /// <summary>
    /// La huella de lo que haya en esa ruta, o vacío si no hay nada.
    ///
    /// Una ruta que no existe devuelve cadena vacía en lugar de fallar: quien
    /// compara ya tiene que tratar el caso de «esto no es lo mismo», y una
    /// excepción aquí solo cambiaría el mensaje por uno peor.
    /// </summary>
    public static string Of(string path)
    {
        if (string.IsNullOrWhiteSpace(path))
        {
            return string.Empty;
        }

        try
        {
            if (File.Exists(path))
            {
                return Hash([Describe(new FileInfo(path), Path.GetFileName(path))]);
            }

            if (!Directory.Exists(path))
            {
                return string.Empty;
            }

            // Ordenado: el sistema de archivos no promete ningún orden, y dos
            // huellas distintas de la misma carpeta harían que la restauración se
            // negara a sí misma.
            var entries = new DirectoryInfo(path)
                .EnumerateFiles("*", SearchOption.AllDirectories)
                .Select(file => Describe(file, Path.GetRelativePath(path, file.FullName)))
                .Order(StringComparer.Ordinal)
                .ToArray();

            return Hash(entries);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // No poder leerlo es indistinguible de que no esté: en los dos casos
            // no se puede afirmar que sea el mismo artefacto.
            return string.Empty;
        }
    }

    /// <summary>Un archivo, resumido en lo que cambia cuando cambia.</summary>
    private static string Describe(FileInfo file, string name) =>
        string.Create(
            CultureInfo.InvariantCulture,
            $"{name}|{file.Length}|{file.LastWriteTimeUtc:O}");

    private static string Hash(IReadOnlyList<string> entries) =>
        Convert.ToHexString(
            SHA256.HashData(Encoding.UTF8.GetBytes(string.Join('\n', entries))));
}
