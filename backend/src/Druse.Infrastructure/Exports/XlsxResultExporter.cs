using ClosedXML.Excel;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;

namespace Druse.Infrastructure.Exports;

/// <summary>
/// Exporta a XLSX con ClosedXML.
///
/// **Al contrario que el CSV, esto sí carga el resultado en memoria**: el
/// formato XLSX es un ZIP con XML interrelacionado y no se puede ir escribiendo
/// fila a fila sin construir antes el libro. De ahí que el tope de filas sea muy
/// inferior; para volúmenes grandes, CSV es la vía.
/// </summary>
public sealed class XlsxResultExporter : IResultExporter
{
    /// <summary>
    /// Tope propio de este formato.
    ///
    /// Una hoja de Excel admite 1 048 576 filas, pero mucho antes de llegar ahí
    /// el proceso se quedaría sin memoria construyendo el libro. 200 000 es un
    /// límite que cabe holgadamente y sigue siendo más de lo que nadie va a
    /// revisar a mano.
    /// </summary>
    private const int FormatRowLimit = 200_000;

    public ExportFormat Format => ExportFormat.Xlsx;

    public string FileExtension => "xlsx";

    public string ContentType =>
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

    public async Task<ExportResult> WriteAsync(
        IQueryResultReader reader,
        Stream destination,
        ExportOptions options,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(reader);
        ArgumentNullException.ThrowIfNull(destination);
        ArgumentNullException.ThrowIfNull(options);

        var limit = Math.Min(options.MaxRows, FormatRowLimit);

        using var workbook = new XLWorkbook();
        var sheet = workbook.AddWorksheet("Resultados");

        var rowIndex = 1;

        if (options.IncludeHeaders)
        {
            for (var column = 0; column < reader.Columns.Count; column++)
            {
                var cell = sheet.Cell(rowIndex, column + 1);
                cell.Value = reader.Columns[column].Name;
                cell.Style.Font.Bold = true;
            }

            // Fija la cabecera al desplazarse: con miles de filas, perderla de
            // vista deja los datos sin significado.
            sheet.SheetView.FreezeRows(1);
            rowIndex++;
        }

        long rows = 0;
        var truncated = false;

        await foreach (var row in reader.ReadRowsAsync(cancellationToken))
        {
            if (rows >= limit)
            {
                truncated = true;
                break;
            }

            for (var column = 0; column < row.Count; column++)
            {
                var value = row[column];

                // Los valores se escriben como texto a propósito. Dejar que Excel
                // los interprete convertiría «007» en 7 y algunas fechas en el
                // formato del sistema: el archivo dejaría de representar lo que
                // hay en la base de datos.
                sheet.Cell(rowIndex, column + 1).SetValue(value ?? options.NullText);
            }

            rowIndex++;
            rows++;
        }

        sheet.Columns().AdjustToContents(1, 200);

        // ClosedXML necesita un destino con posicionamiento para armar el ZIP, y
        // el cuerpo de una respuesta HTTP no lo tiene. Se compone en memoria y se
        // copia. No supone una limitación nueva: este formato ya obligaba a tener
        // el libro entero en memoria, de ahí su tope de filas.
        using var buffer = new MemoryStream();

        workbook.SaveAs(buffer);
        buffer.Position = 0;

        await buffer.CopyToAsync(destination, cancellationToken);

        return new ExportResult(rows, truncated);
    }
}
