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
    public ImportFormat Format => ImportFormat.Xlsx;

    public Task<TableFile> ReadAsync(
        Stream file,
        ImportOptions options,
        int maxRows,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(file);
        ArgumentNullException.ThrowIfNull(options);

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
