using System.IO.Compression;

using ClosedXML.Excel;
using Druse.Application.Abstractions;

namespace Druse.Infrastructure.Importing;

/// <summary>
/// Lee la primera hoja de un libro de Excel.
///
/// Se usa ClosedXML, que ya está para exportar. Todo se lee **como texto**: es
/// lo que hace que un código con ceros delante siga siendo `007` y no 7, y que
/// una fecha llegue tal y como se ve en la hoja en lugar de como el número de
/// serie que Excel guarda por dentro.
/// </summary>
public sealed class XlsxTableFileReader : ITableFileReader
{
    /// <summary>
    /// Cuánto puede ocupar el libro una vez descomprimido.
    ///
    /// Un `.xlsx` es un zip, y un zip puede prometer poco y traer mucho: dos
    /// megas de archivo con veinte gigas dentro es un ataque conocido y viejo.
    /// Aquí no hace falta ni mala intención —una hoja con un millón de filas
    /// comprime durísimo— y el resultado es el mismo: ClosedXML lo carga entero
    /// en memoria y el proceso se cae.
    ///
    /// El tope se mira **antes de abrir el libro**, que es el único momento en
    /// que sirve de algo.
    /// </summary>
    private const long MaxUncompressedBytes = 256L * 1024 * 1024;

    /// <summary>
    /// Cuántas veces puede crecer al descomprimirse antes de considerarlo un
    /// archivo preparado para hacer daño.
    ///
    /// Una hoja normal comprime bien —texto repetido, mucho XML— pero no mil
    /// veces. Se deja margen de sobra: lo que se busca cazar es lo absurdo.
    /// </summary>
    private const int MaxCompressionRatio = 200;

    public ImportFormat Format => ImportFormat.Xlsx;

    public Task<TableFile> ReadAsync(
        Stream file,
        ImportOptions options,
        int maxRows,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(file);
        ArgumentNullException.ThrowIfNull(options);

        EnsureReasonable(file);

        using var workbook = new XLWorkbook(file);
        var hoja = workbook.Worksheets.FirstOrDefault();

        if (hoja is null)
        {
            return Task.FromResult(new TableFile { Columns = [], Rows = [] });
        }

        var usado = hoja.RangeUsed();

        if (usado is null)
        {
            return Task.FromResult(new TableFile { Columns = [], Rows = [] });
        }

        var filas = usado.RowsUsed().ToList();
        var anchura = usado.ColumnCount();

        var columnas = options.HasHeaders && filas.Count > 0
            ? Enumerable.Range(1, anchura)
                .Select(i => Nombre(filas[0].Cell(i).GetFormattedString(), i))
                .ToList()
            : Enumerable.Range(1, anchura).Select(i => $"Columna {i}").ToList();

        var cuerpo = filas
            .Skip(options.HasHeaders ? 1 : 0)
            .Take(maxRows)
            .Select(fila => LeerFila(fila, anchura, options.NullText))
            .ToList();

        return Task.FromResult(new TableFile { Columns = columnas, Rows = cuerpo });
    }

    /// <summary>
    /// Mira el índice del zip antes de dejar que nadie lo abra.
    ///
    /// Los tamaños los declara el propio archivo y podrían mentir, y aun así esta
    /// comprobación vale: lo que se está evitando es cargar en memoria algo
    /// desproporcionado, y un archivo que **declara** veinte gigas ya no hay que
    /// abrirlo. Un zip que mintiera hacia abajo se caería más adelante, donde ya
    /// hay un límite de filas.
    ///
    /// Si el flujo no se puede rebobinar no se comprueba nada en lugar de fallar:
    /// quien lea después se encontrará el archivo tal cual, y el aviso habría sido
    /// peor que el silencio.
    /// </summary>
    private static void EnsureReasonable(Stream file)
    {
        if (!file.CanSeek)
        {
            return;
        }

        var comprimido = file.Length;
        long descomprimido = 0;

        try
        {
            using (var zip = new ZipArchive(file, ZipArchiveMode.Read, leaveOpen: true))
            {
                foreach (var entry in zip.Entries)
                {
                    descomprimido += entry.Length;

                    if (descomprimido > MaxUncompressedBytes)
                    {
                        throw new InvalidOperationException(
                            "El libro ocupa más de 256 MB una vez descomprimido y no se abre: " +
                            "cargarlo entero en memoria tumbaría Druse. Pásalo a CSV o pártelo.");
                    }
                }
            }
        }
        catch (InvalidDataException)
        {
            // No es un zip válido. Que lo diga quien sabe leer libros, con su
            // mensaje: aquí solo se estaba midiendo.
            file.Position = 0;

            return;
        }

        file.Position = 0;

        if (comprimido > 0 && descomprimido / comprimido > MaxCompressionRatio)
        {
            throw new InvalidOperationException(
                "El libro se expande más de doscientas veces al descomprimirlo. No se abre: " +
                "un archivo así no se hace sin querer.");
        }
    }

    private static string Nombre(string valor, int indice) =>
        string.IsNullOrWhiteSpace(valor) ? $"Columna {indice}" : valor.Trim();

    private static string?[] LeerFila(IXLRangeRow fila, int anchura, string nullText)
    {
        var valores = new string?[anchura];

        for (var i = 1; i <= anchura; i++)
        {
            var celda = fila.Cell(i);

            // Una celda vacía de Excel es un hueco, no una cadena vacía: son
            // cosas distintas y la tabla de destino las distingue.
            if (celda.IsEmpty())
            {
                valores[i - 1] = null;
                continue;
            }

            var texto = celda.GetFormattedString();

            valores[i - 1] = nullText.Length > 0 && texto == nullText ? null : texto;
        }

        return valores;
    }
}
