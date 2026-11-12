using Druse.Domain;
using ClosedXML.Excel;
using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using Druse.Application.Abstractions;
using Druse.Application.Reports;
using A = DocumentFormat.OpenXml.Drawing;
using C = DocumentFormat.OpenXml.Drawing.Charts;
using S = DocumentFormat.OpenXml.Spreadsheet;
using Xdr = DocumentFormat.OpenXml.Drawing.Spreadsheet;

namespace Druse.Infrastructure.Exports;

/// <summary>
/// Escribe un tablero de Reportes en un libro de Excel.
///
/// Una hoja de resumen con los filtros, la fecha y las cifras de los
/// indicadores; una hoja por panel con lo que dibuja; y una hoja por conjunto
/// con sus filas filtradas. Al contrario que la exportación de resultados, aquí
/// las celdas van **tipadas**: el resultado guardado ya trae el tipo de cada
/// columna, y los códigos con ceros iniciales son texto desde la base, así que
/// tipar no cambia ningún dato.
///
/// Las barras y las líneas se reconstruyen como gráficos nativos de Excel sobre
/// la tabla de su hoja: se pueden editar, y cambian si se cambian los números.
/// ClosedXML no sabe dibujar gráficos, así que se añaden después con OpenXML
/// sobre el mismo paquete.
/// </summary>
public sealed class ReportWorkbookWriter : IReportWorkbookWriter
{
    private const int ExcelCellCharacterLimit = 32_767;
    private const string DateFormat = "yyyy-mm-dd";
    private const string DateTimeFormat = "yyyy-mm-dd hh:mm";

    /// <summary>Un gráfico pendiente de añadir cuando ClosedXML termine el libro.</summary>
    private sealed record PendingChart(
        string Sheet,
        ReportExportChart Kind,
        int HeaderRow,
        int LastRow,
        bool NumericCategory,
        string? Color,
        int AnchorColumn);

    public byte[] Write(ReportExportDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        if (ReportExportRules.Validate(document) is { } problem)
        {
            throw new ReportProblemException(problem);
        }

        var names = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var charts = new List<PendingChart>();

        using var workbook = new XLWorkbook();
        WriteSummary(workbook.AddWorksheet(SheetName(document.Labels.Summary, names)), document);

        foreach (var panel in document.Panels)
        {
            var sheet = workbook.AddWorksheet(SheetName(panel.Title, names));
            if (WritePanel(sheet, panel, document) is { } chart)
            {
                charts.Add(chart);
            }
        }

        foreach (var dataset in document.Datasets)
        {
            WriteDataset(workbook.AddWorksheet(SheetName($"{document.Labels.Data} · {dataset.Name}", names)), dataset, document.Labels);
        }

        using var buffer = new MemoryStream();
        workbook.SaveAs(buffer);

        if (charts.Count > 0)
        {
            AddCharts(buffer, charts);
        }

        return buffer.ToArray();
    }

    // --- Hojas ------------------------------------------------------------------

    private static void WriteSummary(IXLWorksheet sheet, ReportExportDocument document)
    {
        var labels = document.Labels;

        Title(sheet.Cell(1, 1), document.Title, 16);
        sheet.Cell(2, 1).Value = labels.Generated;
        DateTimeCell(sheet.Cell(2, 2), document.GeneratedAtUtc);

        var row = 4;
        sheet.Cell(row, 1).Value = labels.Filters;
        sheet.Cell(row, 1).Style.Font.Bold = true;
        row++;

        if (document.Filters.Count == 0)
        {
            sheet.Cell(row++, 1).Value = labels.NoFilters;
        }

        foreach (var filter in document.Filters)
        {
            sheet.Cell(row, 1).Value = filter.Label;
            sheet.Cell(row, 2).Value = Text(filter.Value);
            row++;
        }

        row++;
        var header = row;
        string[] headers = [labels.Panel, labels.Page, labels.Dataset, labels.CapturedAt, labels.Value, labels.Target, labels.Ratio];
        for (var column = 0; column < headers.Length; column++)
        {
            Header(sheet.Cell(header, column + 1), headers[column]);
        }

        foreach (var panel in document.Panels)
        {
            row++;
            var dataset = document.Datasets[panel.Dataset];

            sheet.Cell(row, 1).Value = Text(panel.Title);
            sheet.Cell(row, 2).Value = Text(panel.Page);
            sheet.Cell(row, 3).Value = Text(dataset.Name);
            DateTimeCell(sheet.Cell(row, 4), dataset.CapturedAtUtc);

            if (panel.Indicator is { } indicator)
            {
                Number(sheet.Cell(row, 5), indicator.Value);
                Number(sheet.Cell(row, 6), indicator.Target);
                Number(sheet.Cell(row, 7), indicator.Ratio);
                sheet.Cell(row, 7).Style.NumberFormat.Format = "0.0%";
            }
        }

        sheet.Range(header, 1, row, headers.Length).SetAutoFilter();
        sheet.Columns(1, headers.Length).AdjustToContents(1, 200);
    }

    private static PendingChart? WritePanel(IXLWorksheet sheet, ReportExportPanel panel, ReportExportDocument document)
    {
        var labels = document.Labels;
        var dataset = document.Datasets[panel.Dataset];
        var row = 1;

        Title(sheet.Cell(row++, 1), panel.Title, 14);

        if (!string.IsNullOrWhiteSpace(panel.Description))
        {
            sheet.Cell(row++, 1).Value = Text(panel.Description);
        }

        sheet.Cell(row, 1).Value = labels.Page;
        sheet.Cell(row++, 2).Value = Text(panel.Page);
        sheet.Cell(row, 1).Value = labels.Dataset;
        sheet.Cell(row++, 2).Value = Text(dataset.Name);
        sheet.Cell(row, 1).Value = labels.CapturedAt;
        DateTimeCell(sheet.Cell(row++, 2), dataset.CapturedAtUtc);

        foreach (var note in panel.Notes)
        {
            sheet.Cell(row, 1).Value = Text(note);
            sheet.Cell(row++, 1).Style.Font.Italic = true;
        }

        var header = row + 1;
        var last = WriteTable(sheet, panel.Figures, header);
        sheet.SheetView.FreezeRows(header);

        var chartable = panel.Chart != ReportExportChart.None
            && panel.Figures.Rows.Count > 0
            && panel.Figures.Columns.Count >= 2
            && panel.Figures.Columns[1].Type == ReportExportCellType.Number;

        return chartable
            ? new PendingChart(
                sheet.Name,
                panel.Chart,
                header,
                last,
                panel.Figures.Columns[0].Type is ReportExportCellType.Number or ReportExportCellType.Date or ReportExportCellType.DateTime,
                panel.Color,
                panel.Figures.Columns.Count + 1)
            : null;
    }

    private static void WriteDataset(IXLWorksheet sheet, ReportExportDataset dataset, ReportExportLabels labels)
    {
        Title(sheet.Cell(1, 1), dataset.Name, 14);
        sheet.Cell(2, 1).Value = labels.CapturedAt;
        DateTimeCell(sheet.Cell(2, 2), dataset.CapturedAtUtc);
        WriteTable(sheet, dataset.Table, 4);
        sheet.SheetView.FreezeRows(4);
    }

    /// <summary>Escribe cabecera y filas desde `header`; devuelve la última fila escrita.</summary>
    private static int WriteTable(IXLWorksheet sheet, ReportExportTable table, int header)
    {
        for (var column = 0; column < table.Columns.Count; column++)
        {
            Header(sheet.Cell(header, column + 1), table.Columns[column].Name);
        }

        var row = header;
        foreach (var values in table.Rows)
        {
            row++;
            for (var column = 0; column < table.Columns.Count; column++)
            {
                Value(sheet.Cell(row, column + 1), table.Columns[column].Type, values[column]);
            }
        }

        if (table.Columns.Count > 0)
        {
            sheet.Range(header, 1, row, table.Columns.Count).SetAutoFilter();
            sheet.Columns(1, table.Columns.Count).AdjustToContents(header, 200);
        }

        return row;
    }

    // --- Celdas -----------------------------------------------------------------

    private static void Value(IXLCell cell, ReportExportCellType type, object? value)
    {
        switch (value)
        {
            case null:
                cell.Value = Blank.Value;
                return;
            case decimal number:
                cell.Value = number;
                break;
            case double number:
                cell.Value = number;
                break;
            case DateTime date:
                cell.Value = date;
                break;
            case bool flag:
                cell.Value = flag;
                return;
            default:
                // Como texto, nunca como fórmula: `SetValue` de una cadena no se interpreta.
                cell.Value = Text(Convert.ToString(value, System.Globalization.CultureInfo.InvariantCulture) ?? string.Empty);
                return;
        }

        cell.Style.NumberFormat.Format = type switch
        {
            ReportExportCellType.Date => DateFormat,
            ReportExportCellType.DateTime => DateTimeFormat,
            ReportExportCellType.Percent => "0.0%",
            _ => cell.Style.NumberFormat.Format,
        };
    }

    private static void Number(IXLCell cell, decimal? value)
    {
        cell.Value = value is { } number ? number : Blank.Value;
    }

    private static void DateTimeCell(IXLCell cell, DateTimeOffset value)
    {
        // La API corre en el equipo de quien exporta: su hora local es la que
        // se ve en Druse junto a «Datos del…».
        cell.Value = value.ToLocalTime().DateTime;
        cell.Style.NumberFormat.Format = DateTimeFormat;
        cell.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Left;
    }

    private static void Title(IXLCell cell, string text, int size)
    {
        cell.Value = Text(text);
        cell.Style.Font.Bold = true;
        cell.Style.Font.FontSize = size;
    }

    private static void Header(IXLCell cell, string text)
    {
        cell.Value = Text(text);
        cell.Style.Font.Bold = true;
        cell.Style.Fill.BackgroundColor = XLColor.FromHtml("#E6EAF3");
    }

    private static string Text(string text) =>
        text.Length <= ExcelCellCharacterLimit ? text : text[..(ExcelCellCharacterLimit - 1)] + "…";

    /// <summary>
    /// Un nombre de hoja válido y único: Excel limita a 31 caracteres, prohíbe
    /// `[]:*?/\` y no distingue mayúsculas al comparar.
    /// </summary>
    internal static string SheetName(string wanted, ISet<string> taken)
    {
        var clean = new string(wanted.Select(ch => "[]:*?/\\".Contains(ch, StringComparison.Ordinal) || char.IsControl(ch) ? ' ' : ch).ToArray())
            .Trim()
            .Trim('\'');

        // Lo prohibido se cambió por espacios: «Cumplimiento: enero» no deja dos seguidos.
        clean = System.Text.RegularExpressions.Regex.Replace(clean, @"\s+", " ");

        if (clean.Length == 0)
        {
            clean = "Hoja";
        }

        var candidate = clean.Length > 31 ? clean[..31].TrimEnd() : clean;
        for (var n = 2; taken.Contains(candidate); n++)
        {
            var suffix = $" ({n})";
            candidate = (clean.Length > 31 - suffix.Length ? clean[..(31 - suffix.Length)].TrimEnd() : clean) + suffix;
        }

        taken.Add(candidate);
        return candidate;
    }

    // --- Gráficos nativos ---------------------------------------------------------

    private static void AddCharts(MemoryStream buffer, IReadOnlyList<PendingChart> charts)
    {
        buffer.Position = 0;

        using (var package = SpreadsheetDocument.Open(buffer, isEditable: true))
        {
            var workbookPart = package.WorkbookPart!;
            uint id = 1;

            foreach (var chart in charts)
            {
                var sheet = workbookPart.Workbook.Descendants<S.Sheet>().First(item => item.Name == chart.Sheet);
                var worksheetPart = (WorksheetPart)workbookPart.GetPartById(sheet.Id!);
                AddChart(worksheetPart, chart, id++);
            }
        }

        buffer.Position = 0;
    }

    private static void AddChart(WorksheetPart worksheetPart, PendingChart chart, uint id)
    {
        var drawingsPart = worksheetPart.DrawingsPart ?? worksheetPart.AddNewPart<DrawingsPart>();

        if (!worksheetPart.Worksheet.Elements<S.Drawing>().Any())
        {
            // El orden de los hijos de <worksheet> lo fija el esquema: el dibujo
            // va antes de las tablas y de las extensiones, o Excel «repara» el libro.
            var drawing = new S.Drawing { Id = worksheetPart.GetIdOfPart(drawingsPart) };
            var before = worksheetPart.Worksheet.ChildElements.FirstOrDefault(element =>
                element is S.LegacyDrawing or S.LegacyDrawingHeaderFooter or S.Picture or S.OleObjects
                    or S.Controls or S.WebPublishItems or S.TableParts or S.WorksheetExtensionList);

            if (before is null)
            {
                worksheetPart.Worksheet.Append(drawing);
            }
            else
            {
                worksheetPart.Worksheet.InsertBefore(drawing, before);
            }
        }

        drawingsPart.WorksheetDrawing ??= new Xdr.WorksheetDrawing();

        var chartPart = drawingsPart.AddNewPart<ChartPart>();
        chartPart.ChartSpace = ChartSpace(chart);

        drawingsPart.WorksheetDrawing.Append(new Xdr.TwoCellAnchor(
            new Xdr.FromMarker(
                new Xdr.ColumnId(chart.AnchorColumn.ToString(System.Globalization.CultureInfo.InvariantCulture)),
                new Xdr.ColumnOffset("0"),
                new Xdr.RowId((chart.HeaderRow - 1).ToString(System.Globalization.CultureInfo.InvariantCulture)),
                new Xdr.RowOffset("0")),
            new Xdr.ToMarker(
                new Xdr.ColumnId((chart.AnchorColumn + 9).ToString(System.Globalization.CultureInfo.InvariantCulture)),
                new Xdr.ColumnOffset("0"),
                new Xdr.RowId((chart.HeaderRow + 19).ToString(System.Globalization.CultureInfo.InvariantCulture)),
                new Xdr.RowOffset("0")),
            new Xdr.GraphicFrame(
                new Xdr.NonVisualGraphicFrameProperties(
                    new Xdr.NonVisualDrawingProperties { Id = id + 1, Name = $"Chart {id}" },
                    new Xdr.NonVisualGraphicFrameDrawingProperties()),
                new Xdr.Transform(new A.Offset { X = 0, Y = 0 }, new A.Extents { Cx = 0, Cy = 0 }),
                new A.Graphic(new A.GraphicData(new C.ChartReference { Id = drawingsPart.GetIdOfPart(chartPart) })
                {
                    Uri = "http://schemas.openxmlformats.org/drawingml/2006/chart",
                }))
            { Macro = string.Empty },
            new Xdr.ClientData()));

        drawingsPart.WorksheetDrawing.Save();
        worksheetPart.Worksheet.Save();
    }

    private static C.ChartSpace ChartSpace(PendingChart chart)
    {
        var sheet = $"'{chart.Sheet.Replace("'", "''", StringComparison.Ordinal)}'";
        var first = chart.HeaderRow + 1;
        var categories = $"{sheet}!$A${first}:$A${chart.LastRow}";
        var values = $"{sheet}!$B${first}:$B${chart.LastRow}";
        var name = $"{sheet}!$B${chart.HeaderRow}";

        OpenXmlElement CategoryData() => chart.NumericCategory
            ? new C.CategoryAxisData(new C.NumberReference(new C.Formula(categories)))
            : new C.CategoryAxisData(new C.StringReference(new C.Formula(categories)));

        var fill = chart.Color is { Length: 7 } hex && hex[0] == '#'
            ? new C.ChartShapeProperties(new A.SolidFill(new A.RgbColorModelHex { Val = hex[1..].ToUpperInvariant() }))
            : null;

        OpenXmlElement plot;
        if (chart.Kind == ReportExportChart.Line)
        {
            var series = new C.LineChartSeries(
                new C.Index { Val = 0 },
                new C.Order { Val = 0 },
                new C.SeriesText(new C.StringReference(new C.Formula(name))));
            if (fill is not null)
            {
                series.Append(new C.ChartShapeProperties(new A.Outline(fill.GetFirstChild<A.SolidFill>()!.CloneNode(true)) { Width = 28575 }));
            }

            series.Append(new C.Marker(new C.Symbol { Val = C.MarkerStyleValues.Circle }, new C.Size { Val = 6 }));
            series.Append(CategoryData());
            series.Append(new C.Values(new C.NumberReference(new C.Formula(values))));
            series.Append(new C.Smooth { Val = false });

            plot = new C.LineChart(
                new C.Grouping { Val = C.GroupingValues.Standard },
                new C.VaryColors { Val = false },
                series,
                new C.ShowMarker { Val = true },
                new C.AxisId { Val = 1 },
                new C.AxisId { Val = 2 });
        }
        else
        {
            var series = new C.BarChartSeries(
                new C.Index { Val = 0 },
                new C.Order { Val = 0 },
                new C.SeriesText(new C.StringReference(new C.Formula(name))));
            if (fill is not null)
            {
                series.Append(fill);
            }

            series.Append(new C.InvertIfNegative { Val = false });
            series.Append(CategoryData());
            series.Append(new C.Values(new C.NumberReference(new C.Formula(values))));

            plot = new C.BarChart(
                new C.BarDirection { Val = C.BarDirectionValues.Column },
                new C.BarGrouping { Val = C.BarGroupingValues.Clustered },
                new C.VaryColors { Val = false },
                series,
                new C.GapWidth { Val = 80 },
                new C.AxisId { Val = 1 },
                new C.AxisId { Val = 2 });
        }

        var space = new C.ChartSpace(
            new C.RoundedCorners { Val = false },
            new C.Chart(
                new C.AutoTitleDeleted { Val = true },
                new C.PlotArea(
                    new C.Layout(),
                    plot,
                    new C.CategoryAxis(
                        new C.AxisId { Val = 1 },
                        new C.Scaling(new C.Orientation { Val = C.OrientationValues.MinMax }),
                        new C.Delete { Val = false },
                        new C.AxisPosition { Val = C.AxisPositionValues.Bottom },
                        new C.NumberingFormat { FormatCode = "General", SourceLinked = true },
                        new C.MajorTickMark { Val = C.TickMarkValues.None },
                        new C.MinorTickMark { Val = C.TickMarkValues.None },
                        new C.TickLabelPosition { Val = C.TickLabelPositionValues.NextTo },
                        new C.CrossingAxis { Val = 2 },
                        new C.Crosses { Val = C.CrossesValues.AutoZero },
                        new C.AutoLabeled { Val = true },
                        new C.LabelAlignment { Val = C.LabelAlignmentValues.Center },
                        new C.LabelOffset { Val = 100 },
                        new C.NoMultiLevelLabels { Val = false }),
                    new C.ValueAxis(
                        new C.AxisId { Val = 2 },
                        new C.Scaling(new C.Orientation { Val = C.OrientationValues.MinMax }),
                        new C.Delete { Val = false },
                        new C.AxisPosition { Val = C.AxisPositionValues.Left },
                        new C.MajorGridlines(),
                        new C.NumberingFormat { FormatCode = "General", SourceLinked = true },
                        new C.MajorTickMark { Val = C.TickMarkValues.None },
                        new C.MinorTickMark { Val = C.TickMarkValues.None },
                        new C.TickLabelPosition { Val = C.TickLabelPositionValues.NextTo },
                        new C.CrossingAxis { Val = 1 },
                        new C.Crosses { Val = C.CrossesValues.AutoZero },
                        new C.CrossBetween { Val = C.CrossBetweenValues.Between })),
                new C.PlotVisibleOnly { Val = true },
                new C.DisplayBlanksAs { Val = C.DisplayBlanksAsValues.Gap }));

        space.AddNamespaceDeclaration("c", "http://schemas.openxmlformats.org/drawingml/2006/chart");
        space.AddNamespaceDeclaration("a", "http://schemas.openxmlformats.org/drawingml/2006/main");
        space.AddNamespaceDeclaration("r", "http://schemas.openxmlformats.org/officeDocument/2006/relationships");
        return space;
    }
}
