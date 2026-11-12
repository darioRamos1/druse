namespace Druse.Application.Reports;

/// <summary>
/// Un tablero o un panel listo para escribirse en un libro de Excel.
///
/// Lo calcula la interfaz con los filtros que estaban activos al pulsar
/// «Exportar», sobre los resultados guardados: es la única forma de que las
/// cifras del archivo sean exactamente las de la vista. El servidor no vuelve a
/// filtrar ni a agregar; solo da formato, tipa las celdas y dibuja los gráficos.
/// Los textos fijos (nombres de hoja, «Filtros», «Datos del») también llegan
/// hechos, en el idioma de quien exporta.
/// </summary>
public sealed record ReportExportDocument
{
    public required string Title { get; init; }

    public required DateTimeOffset GeneratedAtUtc { get; init; }

    /// <summary>Los filtros activos, ya escritos: «Mes: 01/01/2026 – 31/01/2026».</summary>
    public required IReadOnlyList<ReportExportFilter> Filters { get; init; }

    public required IReadOnlyList<ReportExportPanel> Panels { get; init; }

    /// <summary>Las filas filtradas de cada conjunto usado: una hoja por conjunto.</summary>
    public required IReadOnlyList<ReportExportDataset> Datasets { get; init; }

    public required ReportExportLabels Labels { get; init; }
}

public sealed record ReportExportFilter(string Label, string Value);

/// <summary>Cómo se escribe una columna: decide el tipo y el formato de la celda.</summary>
public enum ReportExportCellType
{
    Text,
    Number,
    Date,
    DateTime,
    Boolean,
    /// <summary>Un cociente que se enseña como porcentaje (0,6 → 60 %).</summary>
    Percent,
}

public sealed record ReportExportColumn(string Name, ReportExportCellType Type);

/// <summary>Una tabla con sus valores ya tipados (decimal, DateTime, bool, string o null).</summary>
public sealed record ReportExportTable(IReadOnlyList<ReportExportColumn> Columns, IReadOnlyList<IReadOnlyList<object?>> Rows)
{
    public long CellCount => (long)Columns.Count * Rows.Count;
}

public enum ReportExportChart
{
    None,
    Bar,
    Line,
}

public sealed record ReportExportPanel
{
    public required string Title { get; init; }

    public string? Description { get; init; }

    public required string Page { get; init; }

    /// <summary>Posición en <see cref="ReportExportDocument.Datasets"/>.</summary>
    public required int Dataset { get; init; }

    /// <summary>Lo que dibuja el panel: la serie agregada, el indicador o la tabla.</summary>
    public required ReportExportTable Figures { get; init; }

    /// <summary>Barras y líneas se reconstruyen como gráfico editable sobre <see cref="Figures"/>.</summary>
    public ReportExportChart Chart { get; init; }

    /// <summary>Color de la serie en hexadecimal (`#2a78d6`); sin él, el de Excel.</summary>
    public string? Color { get; init; }

    /// <summary>Avisos que acompañan a la cifra: filtros que no aplica, filas sin meta.</summary>
    public IReadOnlyList<string> Notes { get; init; } = [];

    /// <summary>Solo indicadores: la cifra que va a la hoja de resumen.</summary>
    public ReportExportIndicator? Indicator { get; init; }
}

public sealed record ReportExportIndicator(decimal? Value, decimal? Target, decimal? Ratio);

public sealed record ReportExportDataset(string Name, DateTimeOffset CapturedAtUtc, ReportExportTable Table);

/// <summary>Los textos fijos del libro, en el idioma de la interfaz.</summary>
public sealed record ReportExportLabels
{
    public required string Summary { get; init; }
    public required string Generated { get; init; }
    public required string Filters { get; init; }
    public required string NoFilters { get; init; }
    public required string Panel { get; init; }
    public required string Page { get; init; }
    public required string Dataset { get; init; }
    public required string CapturedAt { get; init; }
    public required string Value { get; init; }
    public required string Target { get; init; }
    public required string Ratio { get; init; }
    public required string Data { get; init; }
}

/// <summary>Límites de una exportación de Reportes, comprobados antes de construir el libro.</summary>
public static class ReportExportRules
{
    /// <summary>El mismo tope que la exportación de resultados: unos 730 MB de pico como mucho.</summary>
    public const long MaxCells = 2_000_000;

    public const int MaxPanels = 120;

    /// <summary>`null` si se puede escribir; si no, el motivo.</summary>
    public static string? Validate(ReportExportDocument document)
    {
        ArgumentNullException.ThrowIfNull(document);

        if (document.Panels.Count == 0)
        {
            return "No hay paneles que exportar.";
        }

        if (document.Panels.Count > MaxPanels)
        {
            return $"Un libro admite hasta {MaxPanels} paneles.";
        }

        if (document.Panels.Any(panel => panel.Dataset < 0 || panel.Dataset >= document.Datasets.Count))
        {
            return "Un panel apunta a un conjunto de datos que no viene en la exportación.";
        }

        var tables = document.Panels.Select(panel => panel.Figures).Concat(document.Datasets.Select(dataset => dataset.Table));
        if (tables.Any(table => table.Rows.Any(row => row.Count != table.Columns.Count)))
        {
            return "Una tabla de la exportación tiene filas que no cuadran con sus columnas.";
        }

        var cells = tables.Sum(table => table.CellCount);
        return cells > MaxCells
            ? $"La exportación tiene {cells:N0} celdas y el límite de Excel en Druse es {MaxCells:N0}. Filtra el tablero o exporta un panel."
            : null;
    }
}
