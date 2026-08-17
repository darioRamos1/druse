using System.Globalization;
using System.IO.Compression;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Infrastructure.Backups;

/// <summary>
/// Lo que comparten las formas de escribir un respaldo: dónde va cada entrada y
/// cómo se serializa el manifiesto.
///
/// La ruta de una entrada es la misma se escriba en una carpeta o dentro de un
/// `.zip`; lo único que cambia es quién abre el flujo. Por eso el reparto vive
/// aquí y no repetido en cada implementación.
/// </summary>
public abstract class BackupSinkBase : IBackupSink
{
    /// <summary>
    /// El manifiesto se escribe como lo escribe el resto de la API: nombres en
    /// minúscula inicial y enumerados como texto.
    ///
    /// Lo va a leer el mismo cliente que lee todo lo demás, y lo va a abrir una
    /// persona en un editor: un `"outcome": 2` no dice nada, y un `FormatVersion`
    /// entre campos `formatVersion` delata que hay dos criterios.
    /// </summary>
    private static readonly JsonSerializerOptions ManifestJson = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>Nombre del manifiesto dentro del artefacto.</summary>
    protected const string ManifestName = "manifest.json";

    /// <summary>
    /// Carpeta que le toca a cada clase de entrada.
    ///
    /// En español y en plural porque el árbol lo va a mirar una persona, y porque
    /// es lo que verá en el diff cuando versione el respaldo.
    /// </summary>
    protected static string FolderOf(BackupEntryKind kind) => kind switch
    {
        BackupEntryKind.Structure => "tablas",
        BackupEntryKind.Data => "datos",
        _ => "restricciones",
    };

    /// <summary>
    /// Un nombre de objeto convertido en nombre de archivo.
    ///
    /// Una tabla puede llamarse `ventas/2026` o llevar dos puntos, y eso no cabe
    /// en un archivo. Se sustituye lo que el sistema no admite en vez de fallar:
    /// el nombre real está dentro, en el propio guion.
    /// </summary>
    protected static string FileNameOf(string objectName)
    {
        ArgumentNullException.ThrowIfNull(objectName);

        var invalid = Path.GetInvalidFileNameChars();
        var name = new StringBuilder(objectName.Length);

        foreach (var character in objectName)
        {
            name.Append(Array.IndexOf(invalid, character) >= 0 ? '_' : character);
        }

        return name.Length == 0 ? "objeto" : name.ToString();
    }

    protected static byte[] Serialize(BackupManifest manifest) =>
        JsonSerializer.SerializeToUtf8Bytes(manifest, ManifestJson);

    /// <summary>
    /// El manifiesto escrito como comentarios, para los formatos que no admiten un
    /// archivo aparte.
    /// </summary>
    protected static string Commented(BackupManifest manifest)
    {
        ArgumentNullException.ThrowIfNull(manifest);

        var lines = new List<string>
        {
            "-- Respaldo generado por Druse",
            $"-- Formato: {manifest.FormatVersion.ToString(CultureInfo.InvariantCulture)}",
            $"-- Fecha: {manifest.CreatedAt.ToString("u", CultureInfo.InvariantCulture)}",
            $"-- Motor: {manifest.Engine} {manifest.ServerVersion}",
            $"-- Origen: {manifest.Server}/{manifest.Database}",
            $"-- Contenido: {manifest.Tables.ToString(CultureInfo.InvariantCulture)} tablas, " +
            $"{manifest.TablesWithData.ToString(CultureInfo.InvariantCulture)} con datos, " +
            $"{manifest.Rows.ToString(CultureInfo.InvariantCulture)} filas",
            $"-- Resultado: {manifest.Outcome}",
            manifest.ConsistentSnapshot
                ? "-- Todas las tablas se leyeron en el mismo instante."
                : "-- AVISO: las tablas se leyeron una tras otra, no en el mismo instante.",
        };

        lines.AddRange(manifest.Warnings.Select(warning =>
            $"-- AVISO: {warning.Subject}: {warning.Message}"));

        return string.Join(Environment.NewLine, lines);
    }

    public abstract Task WriteAsync(
        BackupEntryKind kind,
        string objectName,
        string text,
        CancellationToken cancellationToken);

    public abstract Task WriteDataStreamAsync(
        string objectName,
        string extension,
        Func<Stream, CancellationToken, Task> write,
        CancellationToken cancellationToken);

    public abstract Task<BackupArtifact> CompleteAsync(
        BackupManifest manifest,
        CancellationToken cancellationToken);

    public abstract Task DiscardAsync(CancellationToken cancellationToken);

    public abstract ValueTask DisposeAsync();
}

/// <summary>
/// Todo el respaldo en un solo `.sql`, en el orden en que hay que ejecutarlo.
///
/// El manifiesto va como cabecera al empezar y **también al final**, con lo que
/// solo se sabe al terminar: los recuentos y los avisos. Reescribir la cabecera
/// obligaría a copiar el archivo entero, que puede ocupar gigabytes.
/// </summary>
public sealed class SingleFileBackupSink : BackupSinkBase
{
    private readonly string _path;
    private readonly StreamWriter _writer;
    private string? _current;
    private bool _discarded;

    public SingleFileBackupSink(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);

        _path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
        _writer = new StreamWriter(File.Create(path), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
    }

    public override async Task WriteAsync(
        BackupEntryKind kind,
        string objectName,
        string text,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        // Una cabecera por objeto y clase de entrada: quien abra el archivo tiene
        // que poder saltar a lo que busca sin leerlo entero.
        var header = $"{kind}:{objectName}";

        if (_current != header)
        {
            _current = header;

            await _writer.WriteLineAsync();
            await _writer.WriteLineAsync($"-- {Titled(kind)}: {objectName}");
        }

        await _writer.WriteLineAsync(text.AsMemory(), cancellationToken);
    }

    public override Task WriteDataStreamAsync(
        string objectName,
        string extension,
        Func<Stream, CancellationToken, Task> write,
        CancellationToken cancellationToken) =>
        throw new NotSupportedException(
            "Un archivo suelto no puede llevar dentro un archivo por tabla: " +
            "los datos en CSV necesitan la salida por carpetas.");

    public override async Task<BackupArtifact> CompleteAsync(
        BackupManifest manifest,
        CancellationToken cancellationToken)
    {
        await _writer.WriteLineAsync();
        await _writer.WriteLineAsync(Commented(manifest).AsMemory(), cancellationToken);
        await _writer.FlushAsync(cancellationToken);
        await _writer.DisposeAsync();

        return new BackupArtifact(_path, new FileInfo(_path).Length);
    }

    public override async Task DiscardAsync(CancellationToken cancellationToken)
    {
        _discarded = true;

        await _writer.DisposeAsync();

        if (File.Exists(_path))
        {
            File.Delete(_path);
        }
    }

    public override async ValueTask DisposeAsync()
    {
        if (!_discarded)
        {
            await _writer.DisposeAsync();
        }
    }

    private static string Titled(BackupEntryKind kind) => kind switch
    {
        BackupEntryKind.Structure => "Tabla",
        BackupEntryKind.Data => "Datos",
        _ => "Restricciones",
    };
}

/// <summary>
/// Un árbol de carpetas con un archivo por objeto, que es lo que se puede
/// versionar y revisar en un diff.
///
/// Al descartarlo **no se borra lo escrito**: aquí se ve qué hay y qué falta, y
/// borrar el trabajo de tres horas por una cancelación sería peor. Lo que se hace
/// es dejarlo marcado como incompleto en su manifiesto.
/// </summary>
public sealed class FolderBackupSink(string root) : BackupSinkBase
{
    private readonly string _root = !string.IsNullOrWhiteSpace(root)
        ? root
        : throw new ArgumentException("Hace falta una carpeta de destino.", nameof(root));

    public override async Task WriteAsync(
        BackupEntryKind kind,
        string objectName,
        string text,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        var path = Path.Combine(_root, FolderOf(kind), $"{FileNameOf(objectName)}.sql");

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // Se añade en lugar de sobrescribir: los datos de una tabla llegan en
        // muchas instrucciones seguidas y todas van al mismo archivo.
        await File.AppendAllTextAsync(
            path,
            text + Environment.NewLine,
            new UTF8Encoding(encoderShouldEmitUTF8Identifier: false),
            cancellationToken);
    }

    public override async Task WriteDataStreamAsync(
        string objectName,
        string extension,
        Func<Stream, CancellationToken, Task> write,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(write);

        var path = Path.Combine(_root, FolderOf(BackupEntryKind.Data), $"{FileNameOf(objectName)}.{extension}");

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        await using var file = File.Create(path);

        await write(file, cancellationToken);
    }

    public override async Task<BackupArtifact> CompleteAsync(
        BackupManifest manifest,
        CancellationToken cancellationToken)
    {
        Directory.CreateDirectory(_root);

        await File.WriteAllBytesAsync(
            Path.Combine(_root, ManifestName),
            Serialize(manifest),
            cancellationToken);

        return new BackupArtifact(_root, SizeOf(_root));
    }

    public override async Task DiscardAsync(CancellationToken cancellationToken)
    {
        if (!Directory.Exists(_root))
        {
            return;
        }

        await File.WriteAllBytesAsync(
            Path.Combine(_root, ManifestName),
            Serialize(new BackupManifest
            {
                DruseVersion = "0.0.0",
                CreatedAt = DateTimeOffset.UtcNow,
                Engine = DatabaseEngine.PostgreSql,
                ServerVersion = string.Empty,
                Outcome = BackupOutcome.Cancelled,
                Warnings = [new BackupWarning(string.Empty, "El respaldo no llegó a terminar.")],
            }),
            cancellationToken);
    }

    public override ValueTask DisposeAsync() => ValueTask.CompletedTask;

    internal static long SizeOf(string directory) =>
        Directory.Exists(directory)
            ? new DirectoryInfo(directory)
                .EnumerateFiles("*", SearchOption.AllDirectories)
                .Sum(file => file.Length)
            : 0;
}

/// <summary>
/// El mismo árbol de carpetas, dentro de un `.zip` con su manifiesto.
///
/// Las entradas se acumulan en memoria por objeto antes de escribirlas: un
/// `ZipArchive` solo admite una entrada abierta a la vez, y los datos de una
/// tabla llegan en muchas instrucciones. Para no crecer sin límite, cada tabla se
/// vuelca en cuanto se pasa a la siguiente.
/// </summary>
public sealed class ZipBackupSink : BackupSinkBase
{
    private readonly string _path;
    private readonly ZipArchive _archive;
    private readonly StringBuilder _buffer = new();

    private string? _entry;
    private bool _discarded;

    public ZipBackupSink(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);

        _path = path;
        Directory.CreateDirectory(Path.GetDirectoryName(path) ?? ".");
        _archive = new ZipArchive(File.Create(path), ZipArchiveMode.Create);
    }

    public override async Task WriteAsync(
        BackupEntryKind kind,
        string objectName,
        string text,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return;
        }

        var entry = $"{FolderOf(kind)}/{FileNameOf(objectName)}.sql";

        if (_entry is not null && _entry != entry)
        {
            await FlushAsync(cancellationToken);
        }

        _entry = entry;
        _buffer.AppendLine(text);
    }

    public override async Task WriteDataStreamAsync(
        string objectName,
        string extension,
        Func<Stream, CancellationToken, Task> write,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(write);

        await FlushAsync(cancellationToken);

        var entry = _archive.CreateEntry(
            $"{FolderOf(BackupEntryKind.Data)}/{FileNameOf(objectName)}.{extension}",
            CompressionLevel.Optimal);

        await using var stream = entry.Open();

        await write(stream, cancellationToken);
    }

    public override async Task<BackupArtifact> CompleteAsync(
        BackupManifest manifest,
        CancellationToken cancellationToken)
    {
        await FlushAsync(cancellationToken);

        var entry = _archive.CreateEntry(ManifestName, CompressionLevel.Optimal);

        await using (var stream = entry.Open())
        {
            await stream.WriteAsync(Serialize(manifest), cancellationToken);
        }

        _archive.Dispose();

        return new BackupArtifact(_path, new FileInfo(_path).Length);
    }

    public override Task DiscardAsync(CancellationToken cancellationToken)
    {
        _discarded = true;
        _archive.Dispose();

        if (File.Exists(_path))
        {
            File.Delete(_path);
        }

        return Task.CompletedTask;
    }

    public override ValueTask DisposeAsync()
    {
        if (!_discarded)
        {
            _archive.Dispose();
        }

        return ValueTask.CompletedTask;
    }

    private async Task FlushAsync(CancellationToken cancellationToken)
    {
        if (_entry is null || _buffer.Length == 0)
        {
            return;
        }

        var entry = _archive.CreateEntry(_entry, CompressionLevel.Optimal);

        await using (var stream = entry.Open())
        await using (var writer = new StreamWriter(stream, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false)))
        {
            await writer.WriteAsync(_buffer.ToString().AsMemory(), cancellationToken);
        }

        _buffer.Clear();
        _entry = null;
    }
}
