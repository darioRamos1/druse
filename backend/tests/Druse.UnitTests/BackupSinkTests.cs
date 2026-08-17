using System.IO.Compression;
using System.Text.Json;
using Druse.Application.Abstractions;
using Druse.Domain;
using Druse.Infrastructure.Backups;

namespace Druse.UnitTests;

/// <summary>
/// Las tres formas de escribir un respaldo, sin base de datos delante.
///
/// Lo que se comprueba aquí es lo que pasa **cuando algo va mal**: que un respaldo
/// a medias no se quede con aspecto de completo, y que un nombre de tabla que no
/// cabe en un archivo no tumbe la operación.
/// </summary>
public sealed class BackupSinkTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"druse-sink-{Guid.NewGuid():N}");


    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private static BackupManifest Manifest(BackupOutcome outcome = BackupOutcome.Completed) => new()
    {
        DruseVersion = "1.0.0",
        CreatedAt = new DateTimeOffset(2026, 8, 17, 14, 0, 0, TimeSpan.Zero),
        Engine = DatabaseEngine.PostgreSql,
        ServerVersion = "18.0",
        Server = "srv-prod",
        Database = "ventas",
        Tables = 2,
        TablesWithData = 1,
        Rows = 41,
        Outcome = outcome,
    };

    private string At(string name) => Path.Combine(_root, name);

    [Fact]
    public async Task UnArchivoSueltoLlevaSuManifiestoComoComentarios()
    {
        var file = At("respaldo.sql");

        await using (var sink = new SingleFileBackupSink(file))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);
            await sink.WriteAsync(BackupEntryKind.Data, "pedidos", "INSERT INTO pedidos VALUES (1);", default);
            await sink.CompleteAsync(Manifest(), default);
        }

        var text = await File.ReadAllTextAsync(file);

        Assert.Contains("-- Tabla: pedidos", text, StringComparison.Ordinal);
        Assert.Contains("-- Datos: pedidos", text, StringComparison.Ordinal);
        Assert.Contains("CREATE TABLE pedidos ();", text, StringComparison.Ordinal);
        Assert.Contains("-- Motor: PostgreSql 18.0", text, StringComparison.Ordinal);
        Assert.Contains("-- Contenido: 2 tablas, 1 con datos, 41 filas", text, StringComparison.Ordinal);

        // Sin instantánea el archivo lo dice: un respaldo que puede no
        // corresponder a ningún momento real de la base no debe parecer que sí.
        Assert.Contains("AVISO: las tablas se leyeron una tras otra", text, StringComparison.Ordinal);
    }

    /// <summary>
    /// Un respaldo a medias con aspecto de completo es más peligroso que no tener
    /// ninguno, así que el archivo se borra.
    /// </summary>
    [Fact]
    public async Task AlDescartarUnArchivoSuelto_NoQuedaNada()
    {
        var file = At("respaldo.sql");

        await using (var sink = new SingleFileBackupSink(file))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);
            await sink.DiscardAsync(default);
        }

        Assert.False(File.Exists(file));
    }

    [Fact]
    public async Task AlDescartarUnZip_NoQuedaNada()
    {
        var file = At("respaldo.zip");

        await using (var sink = new ZipBackupSink(file))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);
            await sink.DiscardAsync(default);
        }

        Assert.False(File.Exists(file));
    }

    /// <summary>
    /// En una carpeta sí se conserva lo escrito —ahí se ve qué hay y qué falta—
    /// pero el manifiesto queda marcado como incompleto.
    /// </summary>
    [Fact]
    public async Task AlDescartarUnaCarpeta_LoEscritoSeQuedaMarcadoComoIncompleto()
    {
        var folder = At("carpeta");

        await using (var sink = new FolderBackupSink(folder))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);
            await sink.DiscardAsync(default);
        }

        Assert.True(File.Exists(Path.Combine(folder, "tablas", "pedidos.sql")));

        var manifest = JsonSerializer.Deserialize<JsonElement>(
            await File.ReadAllTextAsync(Path.Combine(folder, "manifest.json")));

        Assert.Equal("Cancelled", manifest.GetProperty("outcome").GetString());
    }

    [Fact]
    public async Task UnaCarpetaRepartePorTipoYGuardaElManifiesto()
    {
        var folder = At("carpeta");

        await using (var sink = new FolderBackupSink(folder))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);
            await sink.WriteAsync(BackupEntryKind.Data, "pedidos", "INSERT INTO pedidos VALUES (1);", default);
            await sink.WriteAsync(BackupEntryKind.Constraints, "pedidos", "CREATE INDEX ix ON pedidos (id);", default);
            await sink.CompleteAsync(Manifest(), default);
        }

        Assert.True(File.Exists(Path.Combine(folder, "tablas", "pedidos.sql")));
        Assert.True(File.Exists(Path.Combine(folder, "datos", "pedidos.sql")));
        Assert.True(File.Exists(Path.Combine(folder, "restricciones", "pedidos.sql")));

        var manifest = JsonSerializer.Deserialize<JsonElement>(
            await File.ReadAllTextAsync(Path.Combine(folder, "manifest.json")));

        Assert.Equal(1, manifest.GetProperty("formatVersion").GetInt32());
        Assert.Equal("Completed", manifest.GetProperty("outcome").GetString());
    }

    [Fact]
    public async Task UnZipLlevaElMismoArbolYSuManifiesto()
    {
        var file = At("respaldo.zip");

        await using (var sink = new ZipBackupSink(file))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);
            await sink.WriteAsync(BackupEntryKind.Data, "pedidos", "INSERT INTO pedidos VALUES (1);", default);
            await sink.CompleteAsync(Manifest(), default);
        }

        using var archive = ZipFile.OpenRead(file);

        Assert.NotNull(archive.GetEntry("tablas/pedidos.sql"));
        Assert.NotNull(archive.GetEntry("datos/pedidos.sql"));
        Assert.NotNull(archive.GetEntry("manifest.json"));
    }

    /// <summary>
    /// Una tabla puede llamarse como no cabe en un archivo. Se sustituye lo que el
    /// sistema no admite en vez de fallar: el nombre real está dentro, en el guion.
    /// </summary>
    [Fact]
    public async Task UnNombreQueNoCabeEnUnArchivo_SeSustituyeSinFallar()
    {
        var folder = At("carpeta");

        await using (var sink = new FolderBackupSink(folder))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "ventas/2026:enero", "CREATE TABLE x ();", default);
            await sink.CompleteAsync(Manifest(), default);
        }

        var written = Directory.GetFiles(Path.Combine(folder, "tablas"));

        Assert.Single(written);
        Assert.DoesNotContain("/", Path.GetFileName(written[0]), StringComparison.Ordinal);
    }

    /// <summary>
    /// Los datos en CSV necesitan carpetas: un archivo suelto no puede llevar
    /// dentro un archivo por tabla, y decirlo es mejor que escribir algo raro.
    /// </summary>
    [Fact]
    public async Task UnArchivoSueltoNoAdmiteDatosEnCsv()
    {
        await using var sink = new SingleFileBackupSink(At("respaldo.sql"));

        await Assert.ThrowsAsync<NotSupportedException>(async () =>
            await sink.WriteDataStreamAsync("pedidos", "csv", (_, _) => Task.CompletedTask, default));
    }

    [Fact]
    public void LaCombinacionDeSalidaSeValidaAntesDeEmpezar()
    {
        Assert.False(new BackupOutput { Data = BackupDataFormat.Csv }.IsValid);

        Assert.True(new BackupOutput
        {
            Data = BackupDataFormat.Csv,
            Layout = BackupLayout.FolderByKind,
        }.IsValid);
    }
}
