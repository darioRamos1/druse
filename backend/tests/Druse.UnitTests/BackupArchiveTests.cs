using System.IO.Compression;
using System.Text;

using Druse.Application.Abstractions;
using Druse.Infrastructure.Backups;

namespace Druse.UnitTests;

/// <summary>
/// Leer un respaldo ya escrito, sin base de datos delante.
///
/// Lo que se comprueba aquí es lo que la restauración da por hecho: que las
/// entradas salen **en el orden en que hay que aplicarlas**, y que los datos en
/// CSV salen como filas —por lotes y sin cargar el archivo entero— y no como
/// texto que alguien tendría que interpretar después.
/// </summary>
public sealed class BackupArchiveTests : IDisposable
{
    private readonly string _root = Path.Combine(
        Path.GetTempPath(),
        $"druse-archive-{Guid.NewGuid():N}");

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private string Write(string relative, string content)
    {
        var path = Path.Combine(_root, relative);

        Directory.CreateDirectory(Path.GetDirectoryName(path)!);

        // Con BOM, que es lo que escribe el exportador de Druse.
        File.WriteAllText(path, content, new UTF8Encoding(encoderShouldEmitUTF8Identifier: true));

        return path;
    }

    private static async Task<List<BackupEntry>> EntriesOf(string path)
    {
        using var archive = new BackupArchiveFactory().Open(path);

        var entries = new List<BackupEntry>();

        await foreach (var entry in archive.ReadEntriesAsync(default))
        {
            entries.Add(entry);
        }

        return entries;
    }

    [Fact]
    public async Task LosDatosEnCsvSalenComoFilasYEnSuSitio()
    {
        Write("tablas/pedidos.sql", "CREATE TABLE tienda.pedidos (id int, nota text);\n");
        Write("restricciones/pedidos.sql", "CREATE INDEX ix_pedidos ON tienda.pedidos (id);\n");
        Write(
            "datos/pedidos.csv",
            "id,nota\r\n1,\"con, coma\"\r\n2,\"dice \"\"hola\"\"\"\r\n3,\r\n");

        var entries = await EntriesOf(_root);

        // El orden es el del plan: la tabla, sus datos y al final los índices.
        Assert.Collection(
            entries,
            entry => Assert.Contains("CREATE TABLE", Assert.IsType<BackupStatement>(entry).Sql, StringComparison.Ordinal),
            entry =>
            {
                var rows = Assert.IsType<BackupRows>(entry);

                Assert.Equal("pedidos", rows.Table);
                Assert.Equal(1, rows.FirstRow);
                Assert.Equal(["id", "nota"], rows.Columns);

                // Las comillas del RFC se deshacen aquí y no en quien inserta: la
                // coma y las comillas dobladas son del formato, no del dato.
                Assert.Equal(["1", "con, coma"], rows.Rows[0]);
                Assert.Equal(["2", "dice \"hola\""], rows.Rows[1]);
                Assert.Equal(["3", string.Empty], rows.Rows[2]);
            },
            entry => Assert.Contains("CREATE INDEX", Assert.IsType<BackupStatement>(entry).Sql, StringComparison.Ordinal));
    }

    [Fact]
    public async Task UnCsvLargoSeParteEnLotesQueDicenPorDondeVan()
    {
        var csv = new StringBuilder("id,nombre\r\n");

        for (var fila = 1; fila <= 501; fila++)
        {
            csv.Append(fila).Append(",fila ").Append(fila).Append("\r\n");
        }

        Write("datos/clientes.csv", csv.ToString());

        var entries = await EntriesOf(_root);
        var lotes = entries.OfType<BackupRows>().ToList();

        Assert.Equal(2, lotes.Count);
        Assert.Equal(500, lotes[0].Rows.Count);
        Assert.Equal(1, lotes[0].FirstRow);

        // El segundo lote sabe que empieza en la 501: es lo que convierte un error
        // en «falló en la fila 501» en vez de «falló en alguna parte».
        Assert.Single(lotes[1].Rows);
        Assert.Equal(501, lotes[1].FirstRow);
        Assert.Equal(["501", "fila 501"], lotes[1].Rows[0]);
    }

    [Fact]
    public async Task UnaTablaVaciaNoProduceNingunaEntrada()
    {
        Write("datos/vacia.csv", "id,nombre\r\n");

        var entries = await EntriesOf(_root);

        Assert.Empty(entries.OfType<BackupRows>());
    }

    [Fact]
    public async Task UnaFilaCortaSeCompletaConNulos()
    {
        Write("datos/pedidos.csv", "id,nota,total\r\n1,solo dos\r\n");

        var rows = Assert.IsType<BackupRows>(Assert.Single(await EntriesOf(_root)));

        Assert.Equal(["1", "solo dos", null], rows.Rows[0]);
    }

    [Fact]
    public async Task UnZipTambienEntregaSusCsvComoFilas()
    {
        Directory.CreateDirectory(_root);

        var path = Path.Combine(_root, "respaldo.zip");

        using (var file = File.Create(path))
        using (var zip = new ZipArchive(file, ZipArchiveMode.Create))
        {
            await using (var entry = zip.CreateEntry("tablas/pedidos.sql").Open())
            {
                await entry.WriteAsync(Encoding.UTF8.GetBytes("CREATE TABLE tienda.pedidos (id int);\n"));
            }

            await using (var entry = zip.CreateEntry("datos/pedidos.csv").Open())
            {
                await entry.WriteAsync(Encoding.UTF8.GetBytes("id\r\n7\r\n"));
            }
        }

        var entries = await EntriesOf(path);
        var rows = Assert.Single(entries.OfType<BackupRows>());

        Assert.Equal("pedidos", rows.Table);
        Assert.Equal("datos/pedidos.csv", rows.Source);
        Assert.Equal(["7"], rows.Rows[0]);
    }

    [Fact]
    public async Task UnArchivoSueltoSoloTraeInstrucciones()
    {
        var path = Write("respaldo.sql", "CREATE TABLE pedidos (id int);\nINSERT INTO pedidos VALUES (1);\n");

        var entries = await EntriesOf(path);

        Assert.Equal(2, entries.Count);
        Assert.All(entries, entry => Assert.IsType<BackupStatement>(entry));
    }
}
