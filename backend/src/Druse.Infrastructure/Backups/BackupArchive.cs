using System.Globalization;
using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Serialization;

using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Infrastructure.Backups;

/// <summary>
/// Un respaldo ya escrito, abierto para leerlo.
///
/// Se llama archivo y no artefacto porque `BackupArtifact` ya nombra otra cosa:
/// lo que el respaldo **devuelve al terminar** —la ruta y el tamaño—, que es un
/// dato, no algo que se pueda abrir.
///
/// Es la otra mitad de <see cref="BackupSinkBase"/>: lo que aquel reparte en un
/// archivo, una carpeta o un `.zip`, este lo vuelve a juntar en el orden en que
/// hay que ejecutarlo. Que las dos mitades vivan juntas no es casual —si una
/// cambia dónde escribe algo, la otra deja de encontrarlo—.
///
/// **Nada se carga entero en memoria.** Un artefacto puede ocupar gigabytes y se
/// abre para mirarlo, así que el manifiesto se lee suelto y las instrucciones se
/// entregan según se leen.
/// </summary>
public abstract class BackupArchive : IBackupArchive
{
    private static readonly JsonSerializerOptions ManifestJson = new()
    {
        PropertyNameCaseInsensitive = true,
        Converters = { new JsonStringEnumConverter() },
    };

    /// <summary>Nombre del manifiesto dentro del artefacto.</summary>
    protected const string ManifestName = "manifest.json";

    /// <summary>
    /// El orden en que se aplican las carpetas.
    ///
    /// No es alfabético ni casual: es el del §4.2 del plan. Los esquemas antes
    /// que sus tablas, los datos antes que los índices —crearlos antes haría que
    /// cada fila pagara su mantenimiento— y las claves foráneas al final, porque
    /// entre dos tablas puede haber un ciclo y entonces no existe ningún orden de
    /// creación que las satisfaga a la vez.
    /// </summary>
    protected static readonly string[] FolderOrder = ["esquemas", "tablas", "datos", "restricciones"];

    public required string Path { get; init; }

    public abstract BackupLayout Layout { get; }

    public virtual bool Compressed => false;

    /// <summary>El manifiesto, o `null` si el artefacto no lo trae.</summary>
    public abstract Task<BackupManifest?> ReadManifestAsync(CancellationToken cancellationToken);

    /// <summary>Las instrucciones, en el orden en que hay que ejecutarlas.</summary>
    public abstract IAsyncEnumerable<string> ReadStatementsAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Abre lo que haya en esa ruta, mirando qué es.
    ///
    /// Se decide por lo que hay en el disco y no por la extensión: un `.sql`
    /// renombrado sigue siendo un archivo suelto, y una carpeta con un
    /// `manifest.json` dentro sigue siendo un respaldo por carpetas.
    /// </summary>
    internal static BackupArchive OpenPath(string path)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(path);

        if (Directory.Exists(path))
        {
            return new FolderArchive { Path = path };
        }

        if (!File.Exists(path))
        {
            throw new FileNotFoundException($"No se encontró «{path}».", path);
        }

        return IsZip(path)
            ? new ZippedArchive { Path = path }
            : new SingleFileArchive { Path = path };
    }

    /// <summary>
    /// Si el archivo empieza por la firma de un `.zip`.
    ///
    /// Se miran los bytes y no el nombre: el usuario puede haberlo renombrado, y
    /// tratar un zip como texto daría un error ilegible en la primera línea.
    /// </summary>
    private static bool IsZip(string path)
    {
        using var stream = File.OpenRead(path);

        Span<byte> signature = stackalloc byte[2];

        return stream.Read(signature) == 2 && signature[0] == 'P' && signature[1] == 'K';
    }

    protected static BackupManifest? Deserialize(string json)
    {
        try
        {
            return JsonSerializer.Deserialize<BackupManifest>(json, ManifestJson);
        }
        catch (JsonException)
        {
            // Un manifiesto ilegible no puede tirar la inspección: se sigue sin
            // él y quien decide es el usuario, viendo que el artefacto no dice de
            // dónde viene.
            return null;
        }
    }

    public virtual void Dispose() => GC.SuppressFinalize(this);
}

/// <summary>
/// Todo el respaldo en un `.sql`.
///
/// El manifiesto va como comentarios **al final**, porque los recuentos solo se
/// saben al terminar de escribirlo. Por eso aquí se lee la cola del archivo en
/// vez del principio: en uno de cuatrocientos megas, leerlo entero para sacar
/// ocho líneas sería absurdo.
/// </summary>
public sealed class SingleFileArchive : BackupArchive
{
    /// <summary>Cuánto se lee del final buscando el manifiesto.</summary>
    private const int TailBytes = 8 * 1024;

    public override BackupLayout Layout => BackupLayout.SingleFile;

    public override async Task<BackupManifest?> ReadManifestAsync(CancellationToken cancellationToken)
    {
        await using var stream = File.OpenRead(Path);

        var length = stream.Length;
        var take = (int)Math.Min(TailBytes, length);

        stream.Seek(length - take, SeekOrigin.Begin);

        using var reader = new StreamReader(stream);
        var tail = await reader.ReadToEndAsync(cancellationToken);

        return ParseComments(tail);
    }

    public override IAsyncEnumerable<string> ReadStatementsAsync(CancellationToken cancellationToken)
    {
        var reader = new StreamReader(Path);

        return Read(reader, cancellationToken);

        static async IAsyncEnumerable<string> Read(
            StreamReader reader,
            [System.Runtime.CompilerServices.EnumeratorCancellation]
            CancellationToken cancellationToken)
        {
            using (reader)
            {
                await foreach (var statement in SqlStatementReader.ReadAsync(reader, cancellationToken))
                {
                    yield return statement;
                }
            }
        }
    }

    /// <summary>
    /// Rehace el manifiesto desde el bloque de comentarios que lo escribió.
    ///
    /// Es leer lo que <see cref="BackupSinkBase"/> escribió a mano, así que solo
    /// se recupera lo que allí se puso: de lo demás se prefiere no inventar nada.
    /// Basta para lo que hace falta —de qué motor viene y qué versión de formato
    /// es—, que es lo que decide si se puede aplicar.
    /// </summary>
    private static BackupManifest? ParseComments(string tail)
    {
        var lines = tail.Split('\n')
            .Select(line => line.Trim())
            .Where(line => line.StartsWith("--", StringComparison.Ordinal))
            .ToList();

        var header = lines.FindIndex(line =>
            line.Contains("Respaldo generado por Druse", StringComparison.Ordinal));

        if (header < 0)
        {
            return null;
        }

        var engine = Value(lines, "Motor:");
        var parts = engine?.Split(' ', 2, StringSplitOptions.RemoveEmptyEntries) ?? [];

        return new BackupManifest
        {
            DruseVersion = string.Empty,
            CreatedAt = Moment(Value(lines, "Fecha:")),
            Engine = parts.Length > 0 && Enum.TryParse<DatabaseEngine>(parts[0], out var parsed)
                ? parsed
                : DatabaseEngine.PostgreSql,
            ServerVersion = parts.Length > 1 ? parts[1] : string.Empty,
            FormatVersion = int.TryParse(
                Value(lines, "Formato:"),
                NumberStyles.Integer,
                CultureInfo.InvariantCulture,
                out var format)
                ? format
                : 1,
            Database = Value(lines, "Origen:")?.Split('/').LastOrDefault(),
            Outcome = Enum.TryParse<BackupOutcome>(Value(lines, "Resultado:"), out var outcome)
                ? outcome
                : BackupOutcome.Completed,
            ConsistentSnapshot = lines.Exists(line =>
                line.Contains("en el mismo instante", StringComparison.Ordinal)),
            Warnings =
            [
                .. lines
                    .Where(line => line.Contains("AVISO:", StringComparison.Ordinal))
                    .Select(line => new BackupWarning(
                        string.Empty,
                        line[(line.IndexOf("AVISO:", StringComparison.Ordinal) + 6)..].Trim())),
            ],
        };
    }

    private static string? Value(List<string> lines, string label)
    {
        var line = lines.Find(item => item.Contains(label, StringComparison.Ordinal));

        return line?[(line.IndexOf(label, StringComparison.Ordinal) + label.Length)..].Trim();
    }

    private static DateTimeOffset Moment(string? text) =>
        DateTimeOffset.TryParse(
            text,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var moment)
            ? moment
            : DateTimeOffset.MinValue;
}

/// <summary>Un árbol de carpetas con un archivo por objeto.</summary>
public sealed class FolderArchive : BackupArchive
{
    public override BackupLayout Layout => BackupLayout.FolderByKind;

    public override async Task<BackupManifest?> ReadManifestAsync(CancellationToken cancellationToken)
    {
        var file = System.IO.Path.Combine(Path, ManifestName);

        return File.Exists(file)
            ? Deserialize(await File.ReadAllTextAsync(file, cancellationToken))
            : null;
    }

    public override async IAsyncEnumerable<string> ReadStatementsAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation]
        CancellationToken cancellationToken)
    {
        foreach (var folder in FolderOrder)
        {
            var directory = System.IO.Path.Combine(Path, folder);

            if (!Directory.Exists(directory))
            {
                continue;
            }

            // Dentro de una carpeta el orden es el del nombre: entre dos tablas
            // sin dependencias da igual cuál va primero, y ordenarlo hace que dos
            // restauraciones del mismo respaldo se ejecuten igual.
            foreach (var file in Directory.EnumerateFiles(directory, "*.sql").Order(StringComparer.Ordinal))
            {
                using var reader = new StreamReader(file);

                await foreach (var statement in SqlStatementReader.ReadAsync(reader, cancellationToken))
                {
                    yield return statement;
                }
            }
        }
    }
}

/// <summary>El mismo árbol, dentro de un `.zip`.</summary>
public sealed class ZippedArchive : BackupArchive
{
    private ZipArchive? _archive;

    public override BackupLayout Layout => BackupLayout.FolderByKind;

    public override bool Compressed => true;

    private ZipArchive Archive => _archive ??= ZipFile.OpenRead(Path);

    public override async Task<BackupManifest?> ReadManifestAsync(CancellationToken cancellationToken)
    {
        var entry = Archive.GetEntry(ManifestName);

        if (entry is null)
        {
            return null;
        }

        await using var stream = entry.Open();
        using var reader = new StreamReader(stream);

        return Deserialize(await reader.ReadToEndAsync(cancellationToken));
    }

    public override async IAsyncEnumerable<string> ReadStatementsAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation]
        CancellationToken cancellationToken)
    {
        foreach (var folder in FolderOrder)
        {
            var prefix = $"{folder}/";

            var entries = Archive.Entries
                .Where(entry =>
                    entry.FullName.StartsWith(prefix, StringComparison.Ordinal) &&
                    entry.FullName.EndsWith(".sql", StringComparison.OrdinalIgnoreCase))
                .OrderBy(entry => entry.FullName, StringComparer.Ordinal);

            foreach (var entry in entries)
            {
                await using var stream = entry.Open();
                using var reader = new StreamReader(stream);

                await foreach (var statement in SqlStatementReader.ReadAsync(reader, cancellationToken))
                {
                    yield return statement;
                }
            }
        }
    }

    public override void Dispose()
    {
        _archive?.Dispose();
        _archive = null;

        base.Dispose();
    }
}

/// <summary>Abre respaldos escritos por cualquiera de las tres formas de salida.</summary>
public sealed class BackupArchiveFactory : IBackupArchiveFactory
{
    public IBackupArchive Open(string path) => BackupArchive.OpenPath(path);
}
