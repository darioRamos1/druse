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
            await sink.DiscardAsync(Manifest(BackupOutcome.Cancelled), default);
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
            await sink.DiscardAsync(Manifest(BackupOutcome.Cancelled), default);
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
            await sink.DiscardAsync(Manifest(BackupOutcome.Cancelled), default);
        }

        Assert.True(File.Exists(Path.Combine(folder, "tablas", "pedidos.sql")));

        var manifest = JsonSerializer.Deserialize<JsonElement>(
            await File.ReadAllTextAsync(Path.Combine(folder, "manifest.json")));

        Assert.Equal("Cancelled", manifest.GetProperty("outcome").GetString());
    }

    /// <summary>
    /// El manifiesto de una carpeta a medias describe **ese** respaldo.
    ///
    /// Antes se escribía uno de relleno: PostgreSQL, versión 0.0.0, sin servidor
    /// ni base y siempre «cancelado». Una carpeta de SQL Server que había fallado
    /// se presentaba como una de PostgreSQL que alguien paró, y eso es lo único
    /// que tiene delante quien la encuentre medio año después.
    /// </summary>
    [Fact]
    public async Task ElManifiestoDeUnaCarpetaAMedias_ConservaElOrigenYElResultadoReales()
    {
        var folder = At("carpeta");

        await using (var sink = new FolderBackupSink(folder))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);

            await sink.DiscardAsync(
                Manifest(BackupOutcome.Failed) with
                {
                    Engine = DatabaseEngine.SqlServer,
                    ServerVersion = "16.0",
                    Warnings = [new BackupWarning(string.Empty, "El respaldo falló y quedó incompleto: sin permisos.")],
                },
                default);
        }

        var manifest = JsonSerializer.Deserialize<JsonElement>(
            await File.ReadAllTextAsync(Path.Combine(folder, "manifest.json")));

        // Un fallo no es una cancelación: uno se rompió y el otro se paró
        // queriendo, y la diferencia cambia qué hacer con lo que quedó.
        Assert.Equal("Failed", manifest.GetProperty("outcome").GetString());
        Assert.Equal("SqlServer", manifest.GetProperty("engine").GetString());
        Assert.Equal("srv-prod", manifest.GetProperty("server").GetString());
        Assert.Equal("ventas", manifest.GetProperty("database").GetString());
        Assert.Equal("1.0.0", manifest.GetProperty("druseVersion").GetString());

        Assert.Contains(
            "sin permisos",
            manifest.GetProperty("warnings")[0].GetProperty("message").GetString(),
            StringComparison.Ordinal);
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
    /// Dos tablas que se llaman igual en esquemas distintos son dos tablas.
    ///
    /// Cuando el nombre del archivo era solo el de la tabla, la segunda se
    /// escribía **a continuación** de la primera en la carpeta y como una entrada
    /// repetida en el zip. El respaldo decía que se había llevado las dos y solo
    /// una podía restaurarse.
    /// </summary>
    [Fact]
    public async Task DosTablasHomonimasEnEsquemasDistintos_NoCompartenArchivo()
    {
        var folder = At("carpeta");

        await using (var sink = new FolderBackupSink(folder))
        {
            await sink.WriteAsync(
                BackupEntryKind.Structure,
                "ventas.clientes",
                "CREATE TABLE ventas.clientes (id int);",
                default);

            await sink.WriteAsync(
                BackupEntryKind.Structure,
                "compras.clientes",
                "CREATE TABLE compras.clientes (id int);",
                default);

            await sink.CompleteAsync(Manifest(), default);
        }

        var ventas = await File.ReadAllTextAsync(Path.Combine(folder, "tablas", "ventas.clientes.sql"));
        var compras = await File.ReadAllTextAsync(Path.Combine(folder, "tablas", "compras.clientes.sql"));

        Assert.Contains("CREATE TABLE ventas.clientes", ventas, StringComparison.Ordinal);
        Assert.DoesNotContain("compras", ventas, StringComparison.Ordinal);
        Assert.Contains("CREATE TABLE compras.clientes", compras, StringComparison.Ordinal);
    }

    [Fact]
    public async Task EnUnZip_DosTablasHomonimasSonDosEntradas()
    {
        var file = At("respaldo.zip");

        await using (var sink = new ZipBackupSink(file))
        {
            await sink.WriteAsync(
                BackupEntryKind.Structure,
                "ventas.clientes",
                "CREATE TABLE ventas.clientes (id int);",
                default);

            await sink.WriteAsync(
                BackupEntryKind.Structure,
                "compras.clientes",
                "CREATE TABLE compras.clientes (id int);",
                default);

            await sink.CompleteAsync(Manifest(), default);
        }

        using var archive = ZipFile.OpenRead(file);

        Assert.NotNull(archive.GetEntry("tablas/ventas.clientes.sql"));
        Assert.NotNull(archive.GetEntry("tablas/compras.clientes.sql"));

        // Y ninguna repetida: un zip admite dos entradas con el mismo nombre, y
        // quien lo abra verá una sola.
        Assert.Equal(
            archive.Entries.Count,
            archive.Entries.Select(entry => entry.FullName).Distinct(StringComparer.Ordinal).Count());
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
    /// Dos respaldos seguidos a la misma carpeta se mezclaban.
    ///
    /// Los archivos se abren en modo «append» porque los datos de una tabla
    /// llegan en muchas instrucciones, así que el segundo respaldo se escribía a
    /// continuación del primero: una tabla acababa con las filas de las dos
    /// pasadas, las tablas que ya no existían seguían ahí, y el manifiesto —ese
    /// sí reescrito— decía que aquello era un respaldo de un momento.
    /// </summary>
    [Fact]
    public async Task UnaCarpetaQueYaTieneUnRespaldo_SeRechazaEnVezDeMezclarse()
    {
        var folder = At("carpeta");

        await using (var sink = new FolderBackupSink(folder))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);
            await sink.CompleteAsync(Manifest(), default);
        }

        var error = Assert.Throws<IOException>(() => new FolderBackupSink(folder));

        Assert.Contains("ya tiene un respaldo", error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// Quien lo pide explícitamente sí reemplaza, y reemplaza del todo: lo que ya
    /// no está en la base tampoco puede quedarse en la carpeta.
    /// </summary>
    [Fact]
    public async Task ConSobrescritura_LaCarpetaQuedaConElRespaldoNuevoYSoloConEl()
    {
        var folder = At("carpeta");

        await using (var sink = new FolderBackupSink(folder))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "vieja", "CREATE TABLE vieja ();", default);
            await sink.CompleteAsync(Manifest(), default);
        }

        await using (var sink = new FolderBackupSink(folder, overwrite: true))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "nueva", "CREATE TABLE nueva ();", default);
            await sink.CompleteAsync(Manifest(), default);
        }

        Assert.True(File.Exists(Path.Combine(folder, "tablas", "nueva.sql")));
        Assert.False(File.Exists(Path.Combine(folder, "tablas", "vieja.sql")));
    }

    /// <summary>
    /// Sobrescribir es sobrescribir el respaldo, no vaciar la carpeta.
    ///
    /// El usuario pudo elegir una que tenga además cosas suyas, y llevárselas por
    /// delante sería mucho peor que el problema que esto resuelve.
    /// </summary>
    [Fact]
    public async Task ConSobrescritura_NoSeBorraLoQueNoEsDelRespaldo()
    {
        var folder = At("carpeta");

        await using (var sink = new FolderBackupSink(folder))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);
            await sink.CompleteAsync(Manifest(), default);
        }

        var ajeno = Path.Combine(folder, "notas.txt");

        await File.WriteAllTextAsync(ajeno, "esto es del usuario");

        await using (var sink = new FolderBackupSink(folder, overwrite: true))
        {
            await sink.CompleteAsync(Manifest(), default);
        }

        Assert.True(File.Exists(ajeno));
    }

    /// <summary>
    /// El nombre bueno solo aparece cuando el archivo está entero.
    ///
    /// Mientras se escribe, un `.sql` de gigabytes tiene el tamaño y la pinta de
    /// uno terminado: quien lo copie a mitad se lleva algo que parece un respaldo.
    /// </summary>
    [Fact]
    public async Task MientrasSeEscribe_ElArchivoNoTieneTodaviaSuNombre()
    {
        var file = At("respaldo.sql");

        await using (var sink = new SingleFileBackupSink(file))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);

            Assert.False(File.Exists(file));
            Assert.True(File.Exists(file + ".parcial"));

            await sink.CompleteAsync(Manifest(), default);
        }

        Assert.True(File.Exists(file));
        Assert.False(File.Exists(file + ".parcial"));
    }

    /// <summary>
    /// Un respaldo que falla no puede llevarse por delante el que había.
    ///
    /// Antes se creaba el archivo con su nombre definitivo desde el principio, así
    /// que el respaldo bueno del día anterior desaparecía en cuanto empezaba uno
    /// nuevo, y al fallar no quedaba ninguno.
    /// </summary>
    [Fact]
    public async Task SiFallaElRespaldoNuevo_ElAnteriorSigueDondeEstaba()
    {
        var file = At("respaldo.sql");

        await using (var sink = new SingleFileBackupSink(file))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "pedidos", "CREATE TABLE pedidos ();", default);
            await sink.CompleteAsync(Manifest(), default);
        }

        var bueno = await File.ReadAllTextAsync(file);

        await using (var sink = new SingleFileBackupSink(file))
        {
            await sink.WriteAsync(BackupEntryKind.Structure, "otra", "CREATE TABLE otra ();", default);
            await sink.DiscardAsync(Manifest(BackupOutcome.Failed), default);
        }

        Assert.Equal(bueno, await File.ReadAllTextAsync(file));
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
