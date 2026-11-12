using ClosedXML.Excel;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using Druse.Application.Reports;
using Druse.Infrastructure.Exports;
using C = DocumentFormat.OpenXml.Drawing.Charts;

namespace Druse.UnitTests;

/// <summary>
/// Hito 4.4: el Excel de un tablero con el filtro de enero activo. Las cifras
/// llegan calculadas por la interfaz; aquí se comprueba que el libro las
/// conserva tipadas, que cada panel tiene su hoja y que las barras y las líneas
/// son gráficos nativos válidos sobre esas celdas.
/// </summary>
public sealed class ReportWorkbookWriterTests
{
    private static readonly ReportExportLabels Labels = new()
    {
        Summary = "Resumen",
        Generated = "Generado",
        Filters = "Filtros",
        NoFilters = "Sin filtros",
        Panel = "Panel",
        Page = "Página",
        Dataset = "Conjunto",
        CapturedAt = "Datos del",
        Value = "Cifra",
        Target = "Meta",
        Ratio = "Cumplimiento",
        Data = "Datos",
    };

    private static ReportExportTable Table(ReportExportColumn[] columns, params object?[][] rows) =>
        new(columns, rows.Select(row => (IReadOnlyList<object?>)row).ToArray());

    private static ReportExportDocument Enero() => new()
    {
        Title = "Comercial",
        GeneratedAtUtc = new DateTimeOffset(2026, 11, 11, 18, 0, 0, TimeSpan.Zero),
        Filters = [new ReportExportFilter("Mes", "2026-01-01 – 2026-01-31")],
        Labels = Labels,
        Datasets =
        [
            new ReportExportDataset(
                "Ventas y metas",
                new DateTimeOffset(2026, 11, 11, 15, 0, 2, TimeSpan.Zero),
                Table(
                    [new("Ventas.mes", ReportExportCellType.Date), new("Ventas.municipio", ReportExportCellType.Text), new("Ventas.venta", ReportExportCellType.Number)],
                    [new DateTime(2026, 1, 1), "05001", 80m],
                    [new DateTime(2026, 1, 1), "08001", 100m],
                    [new DateTime(2026, 1, 1), "11001", 40m])),
        ],
        Panels =
        [
            new ReportExportPanel
            {
                Title = "Ventas por municipio",
                Page = "Página 1",
                Dataset = 0,
                Chart = ReportExportChart.Bar,
                Color = "#2a78d6",
                Figures = Table(
                    [new("Ventas.municipio", ReportExportCellType.Text), new("Suma · Ventas.venta", ReportExportCellType.Number)],
                    ["05001", 80m], ["08001", 100m], ["11001", 40m]),
            },
            new ReportExportPanel
            {
                Title = "Ventas por mes",
                Page = "Página 2",
                Dataset = 0,
                Chart = ReportExportChart.Line,
                Figures = Table(
                    [new("Ventas.mes", ReportExportCellType.Date), new("Suma · Ventas.venta", ReportExportCellType.Number)],
                    [new DateTime(2026, 1, 1), 220m]),
            },
            new ReportExportPanel
            {
                Title = "Cumplimiento: enero/2026 [meta]",
                Description = "Ventas sobre metas",
                Page = "Página 1",
                Dataset = 0,
                Notes = ["1 fila sin meta queda fuera del cumplimiento."],
                Indicator = new ReportExportIndicator(180m, 300m, 0.6m),
                Figures = Table(
                    [new("Cifra", ReportExportCellType.Number), new("Meta", ReportExportCellType.Number), new("Cumplimiento", ReportExportCellType.Percent)],
                    [180m, 300m, 0.6m]),
            },
        ],
    };

    [Fact]
    public void EscribeUnaHojaPorPanelYPorConjuntoConLasCeldasTipadas()
    {
        using var workbook = new XLWorkbook(new MemoryStream(new ReportWorkbookWriter().Write(Enero())));

        Assert.Equal(
            ["Resumen", "Ventas por municipio", "Ventas por mes", "Cumplimiento enero 2026 meta", "Datos · Ventas y metas"],
            workbook.Worksheets.Select(sheet => sheet.Name));

        var resumen = workbook.Worksheet("Resumen");
        Assert.Equal("Comercial", resumen.Cell(1, 1).GetString());
        Assert.Equal("Mes", resumen.Cell(5, 1).GetString());
        Assert.Equal("2026-01-01 – 2026-01-31", resumen.Cell(5, 2).GetString());
        var indicador = resumen.RowsUsed().Single(row => row.Cell(1).GetString().StartsWith("Cumplimiento", StringComparison.Ordinal));
        Assert.Equal(180, indicador.Cell(5).GetDouble());
        Assert.Equal(0.6, indicador.Cell(7).GetDouble());
        Assert.Equal("0.0%", indicador.Cell(7).Style.NumberFormat.Format);

        var datos = workbook.Worksheet("Datos · Ventas y metas");
        Assert.Equal(XLDataType.DateTime, datos.Cell(5, 1).DataType);
        Assert.Equal(new DateTime(2026, 1, 1), datos.Cell(5, 1).GetDateTime());
        // El código sigue siendo texto: el cero inicial no se pierde.
        Assert.Equal(XLDataType.Text, datos.Cell(5, 2).DataType);
        Assert.Equal("05001", datos.Cell(5, 2).GetString());
        Assert.Equal(XLDataType.Number, datos.Cell(5, 3).DataType);
        Assert.Equal(220, datos.Range(5, 3, 7, 3).Cells().Sum(cell => cell.GetDouble()));

        var barras = workbook.Worksheet("Ventas por municipio");
        var cabecera = barras.RowsUsed().First(row => row.Cell(1).GetString() == "Ventas.municipio").RowNumber();
        Assert.Equal("05001", barras.Cell(cabecera + 1, 1).GetString());
        Assert.Equal(80, barras.Cell(cabecera + 1, 2).GetDouble());

        var cumplimiento = workbook.Worksheet("Cumplimiento enero 2026 meta");
        Assert.Equal("Ventas sobre metas", cumplimiento.Cell(2, 1).GetString());
        Assert.Contains(cumplimiento.CellsUsed(), cell => cell.GetString() == "1 fila sin meta queda fuera del cumplimiento.");
    }

    [Fact]
    public void LasBarrasYLasLineasSonGraficosNativosValidosSobreSusCeldas()
    {
        using var package = SpreadsheetDocument.Open(new MemoryStream(new ReportWorkbookWriter().Write(Enero())), false);
        var workbook = package.WorkbookPart!;

        ChartPart ChartOf(string name)
        {
            var sheet = workbook.Workbook.Descendants<DocumentFormat.OpenXml.Spreadsheet.Sheet>().Single(item => item.Name == name);
            var part = (WorksheetPart)workbook.GetPartById(sheet.Id!);
            return Assert.Single(part.DrawingsPart!.ChartParts);
        }

        var barras = ChartOf("Ventas por municipio").ChartSpace;
        var serie = Assert.Single(barras.Descendants<C.BarChartSeries>());
        Assert.EndsWith("!$A$7:$A$9", serie.Descendants<C.Formula>().ElementAt(1).Text, StringComparison.Ordinal);
        Assert.Equal("'Ventas por municipio'!$B$7:$B$9", serie.Descendants<C.Formula>().ElementAt(2).Text);
        Assert.Equal("2A78D6", serie.Descendants<DocumentFormat.OpenXml.Drawing.RgbColorModelHex>().Single().Val!.Value);

        Assert.Single(ChartOf("Ventas por mes").ChartSpace.Descendants<C.LineChartSeries>());

        // El indicador no tiene gráfico: su cifra está en la tabla y en el resumen.
        var sinGrafico = workbook.Workbook.Descendants<DocumentFormat.OpenXml.Spreadsheet.Sheet>().Single(item => item.Name == "Cumplimiento enero 2026 meta");
        Assert.Null(((WorksheetPart)workbook.GetPartById(sinGrafico.Id!)).DrawingsPart);

        var errores = new OpenXmlValidator()
            .Validate(package)
            .Where(error => error.Part?.Uri.OriginalString.Contains("chart", StringComparison.OrdinalIgnoreCase) == true
                || error.Part?.Uri.OriginalString.Contains("drawing", StringComparison.OrdinalIgnoreCase) == true
                || error.Part is WorksheetPart)
            .Select(error => $"{error.Part?.Uri}: {error.Description}")
            .ToArray();
        Assert.Empty(errores);
    }

    [Fact]
    public void RechazaPanelesSinConjuntoYFilasQueNoCuadran()
    {
        var documento = Enero();

        Assert.Contains("conjunto", ReportExportRules.Validate(documento with
        {
            Panels = [documento.Panels[0] with { Dataset = 3 }],
        }), StringComparison.Ordinal);
        Assert.Contains("no cuadran", ReportExportRules.Validate(documento with
        {
            Panels = [documento.Panels[0] with { Figures = Table([new("a", ReportExportCellType.Text)], ["x", "y"]) }],
        }), StringComparison.Ordinal);
        Assert.Contains("No hay paneles", ReportExportRules.Validate(documento with { Panels = [] }), StringComparison.Ordinal);
    }

    [Fact]
    public void AvisaAntesDeConstruirUnLibroDemasiadoGrande()
    {
        var documento = Enero();
        var fila = new object?[] { "x", 1m };
        var grande = new ReportExportTable(
            [new("a", ReportExportCellType.Text), new("b", ReportExportCellType.Number)],
            Enumerable.Repeat((IReadOnlyList<object?>)fila, (int)(ReportExportRules.MaxCells / 2) + 1).ToArray());

        var problema = ReportExportRules.Validate(documento with
        {
            Datasets = [documento.Datasets[0] with { Table = grande }],
        });

        Assert.NotNull(problema);
        Assert.Contains("límite", problema, StringComparison.Ordinal);
    }

    [Fact]
    public void NombraLasHojasSinCaracteresProhibidosNiRepetidos()
    {
        var usados = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        Assert.Equal("Ventas 2026", ReportWorkbookWriter.SheetName("Ventas/2026", usados));
        Assert.Equal("ventas 2026 (2)", ReportWorkbookWriter.SheetName("ventas 2026", usados));
        Assert.Equal(31, ReportWorkbookWriter.SheetName(new string('a', 40), usados).Length);
        Assert.Equal(31, ReportWorkbookWriter.SheetName(new string('a', 40), usados).Length);
        Assert.Equal("Hoja", ReportWorkbookWriter.SheetName("[]", usados));
    }
}
