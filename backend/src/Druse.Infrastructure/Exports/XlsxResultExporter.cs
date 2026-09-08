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
    private const int ExcelCellCharacterLimit = 32_767;
    private const string TruncatedCellSuffix = "… [recortado por el límite de Excel]";

    /// <summary>
    /// Tope propio de este formato, en filas.
    ///
    /// Una hoja de Excel admite 1 048 576 filas, pero mucho antes de llegar ahí
    /// el proceso se quedaría sin memoria construyendo el libro. 200 000 sigue
    /// siendo más de lo que nadie va a revisar a mano.
    /// </summary>
    private const int FormatRowLimit = 200_000;

    /// <summary>
    /// Y el tope que de verdad manda: celdas.
    ///
    /// La memoria no depende de las filas sino del producto filas × columnas, y
    /// un límite en filas deja la puerta abierta a la tabla ancha. Medido en este
    /// equipo, con diez columnas de texto corriente
    /// (`XlsxMemoryTests`, con `DRUSE_MEDIR_XLSX=1`):
    ///
    /// | Filas   | Celdas | Montón vivo | Reservado | Tiempo |
    /// | ------- | ------ | ----------- | --------- | ------ |
    /// | 10 000  | 100 k  | 72 MB       | 164 MB    | 0,6 s  |
    /// | 50 000  | 500 k  | 200 MB      | 886 MB    | 4,3 s  |
    /// | 100 000 | 1 M    | 370 MB      | 1,5 GB    | 3,5 s  |
    /// | 200 000 | 2 M    | 732 MB      | 3,1 GB    | 6,6 s  |
    ///
    /// Son unos **370 bytes de memoria viva por celda**, lineales. Con el tope
    /// anterior —solo filas— una tabla de cuarenta columnas pedía cuatro veces
    /// eso: cerca de 3 GB, y ahí el proceso muere a mitad y se lleva por delante
    /// el trabajo de la sesión.
    ///
    /// Dos millones de celdas dejan el pico en unos 730 MB **sea cual sea la
    /// forma de la tabla**, y con las diez columnas de siempre no cambia nada
    /// respecto a antes. Para volúmenes mayores está el CSV, que se escribe en
    /// streaming y no crece.
    /// </summary>
    private const int FormatCellLimit = 2_000_000;

    /// <summary>
    /// Cuántas filas caben, contando lo ancha que es la tabla.
    ///
    /// Se separa del cuerpo de la exportación para poder comprobarla sin
    /// construir un libro de un giga.
    /// </summary>
    internal static int RowsThatFit(int columns, int requested)
    {
        // Una tabla sin columnas no reserva nada por fila; el tope en filas sigue
        // aplicando y evita dividir por cero.
        var byCells = columns <= 0 ? FormatRowLimit : Math.Max(1, FormatCellLimit / columns);

        return Math.Min(requested, Math.Min(FormatRowLimit, byCells));
    }

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

        var limit = RowsThatFit(reader.Columns.Count, options.MaxRows);

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
                sheet.Cell(rowIndex, column + 1).SetValue(CellText(value ?? options.NullText));
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

    private static string CellText(string value) =>
        value.Length <= ExcelCellCharacterLimit
            ? value
            : string.Concat(
                value.AsSpan(0, ExcelCellCharacterLimit - TruncatedCellSuffix.Length),
                TruncatedCellSuffix);
}
