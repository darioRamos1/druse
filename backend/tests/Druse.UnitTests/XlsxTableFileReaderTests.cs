using System.IO.Compression;
using System.Text;

using Druse.Application.Abstractions;
using Druse.Infrastructure.Importing;

namespace Druse.UnitTests;

/// <summary>
/// Lo que pasa cuando el archivo que llega a importar no es el que se esperaba.
///
/// Un `.xlsx` es un zip, y ClosedXML lo carga entero en memoria: un archivo que
/// promete dos megas y trae veinte gigas dentro tumba el proceso sin que nadie
/// haya escrito una línea de SQL. Ni siquiera hace falta mala intención —una hoja
/// con un millón de filas repetidas comprime durísimo— y el resultado es el
/// mismo.
/// </summary>
public sealed class XlsxTableFileReaderTests
{
    /// <summary>
    /// Un zip con una entrada enorme y muy comprimible: es la forma del ataque, en
    /// pequeño. Se genera aquí en vez de guardarlo como recurso porque un archivo
    /// así en el repositorio es exactamente lo que nadie quiere descargarse.
    /// </summary>
    private static MemoryStream Bomba(int megas)
    {
        var salida = new MemoryStream();

        using (var zip = new ZipArchive(salida, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entrada = zip.CreateEntry("xl/worksheets/sheet1.xml", CompressionLevel.SmallestSize);

            using var stream = entrada.Open();

            // Ceros: comprimen a casi nada y ocupan lo que dicen al expandirse.
            var bloque = new byte[1024 * 1024];

            for (var mega = 0; mega < megas; mega++)
            {
                stream.Write(bloque);
            }
        }

        salida.Position = 0;

        return salida;
    }

    private static Task<TableFile> LeerAsync(Stream archivo) =>
        new XlsxTableFileReader().ReadAsync(archivo, new ImportOptions(), 1000, CancellationToken.None);

    /// <summary>
    /// Se mira el índice del zip **antes** de abrir el libro, que es el único
    /// momento en que la comprobación sirve de algo.
    /// </summary>
    [Fact]
    public async Task UnLibroQueSeExpandeDeFormaAbsurda_NoSeAbre()
    {
        using var bomba = Bomba(megas: 400);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(() => LeerAsync(bomba));

        Assert.Contains("256 MB", error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// Y lo que no es un libro tampoco revienta aquí: el mensaje lo pone quien
    /// sabe leer libros, no la comprobación de tamaño.
    /// </summary>
    [Fact]
    public async Task UnArchivoQueNoEsUnZip_LoRechazaElLectorDeLibros()
    {
        using var texto = new MemoryStream(Encoding.UTF8.GetBytes("id,nombre\n1,Ana\n"));

        // Cualquier excepción vale menos la de la comprobación de tamaño: lo que
        // se comprueba es que la guardia no se apropia del error.
        var error = await Record.ExceptionAsync(() => LeerAsync(texto));

        Assert.NotNull(error);
        Assert.DoesNotContain("256 MB", error.Message, StringComparison.Ordinal);
    }
}
