using System.Globalization;
using Druse.Application.Reports;
using Druse.Domain;

namespace Druse.Host.LocalApi.Contracts;

public sealed record ReportRunSourceDto(
    string Alias,
    string? FailureCode,
    string? Message,
    int RowCount,
    bool Truncated,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc);

public sealed record ReportRunDto
{
    public required Guid Id { get; init; }
    public required long DefinitionVersion { get; init; }

    /// <summary>`Manual` o `Scheduled`.</summary>
    public required string Origin { get; init; }

    /// <summary>`Succeeded`, `Failed`, `Canceled` o `Interrupted`.</summary>
    public required string Status { get; init; }
    public required DateTimeOffset StartedAtUtc { get; init; }
    public required DateTimeOffset CompletedAtUtc { get; init; }
    public string? Message { get; init; }
    public required IReadOnlyList<string> DuplicateKeys { get; init; }
    public int RowCount { get; init; }
    public required IReadOnlyList<ReportRunSourceDto> Sources { get; init; }
}

/// <summary>
/// La programación de un conjunto. Al guardar solo cuentan la regla y la pausa;
/// el próximo horario, el reintento y si está en marcha los pone el servidor.
/// </summary>
public sealed record ReportScheduleDto
{
    /// <summary>`Daily` o `Weekly`.</summary>
    public required string Frequency { get; init; }

    /// <summary>Hora local de la zona, `HH:mm`.</summary>
    public required string Time { get; init; }

    /// <summary>Días en inglés (`Monday`…); solo cuentan en la semanal.</summary>
    public IReadOnlyList<string> Days { get; init; } = [];

    /// <summary>Zona IANA (`America/Bogota`) o de Windows.</summary>
    public required string TimeZone { get; init; }

    public bool Paused { get; init; }

    public DateTimeOffset? NextRunUtc { get; init; }

    public DateTimeOffset? RetryAtUtc { get; init; }

    public bool Running { get; init; }
}

public sealed record ReportStorageEntryDto(
    Guid DatasetId,
    string Name,
    long SnapshotBytes,
    int RunCount,
    DateTimeOffset? CapturedAtUtc);

/// <summary>El espacio de Reportes BI: el archivo, los resultados y la cuota, en bytes.</summary>
public sealed record ReportStorageDto(
    long FileBytes,
    long SnapshotBytes,
    long QuotaBytes,
    IReadOnlyList<ReportStorageEntryDto> Datasets);

/// <summary>`Outcome`: `Refreshed` o `Failed`; el intento va en `Run`.</summary>
public sealed record ReportRefreshDto(string Outcome, ReportRunDto? Run);

/// <summary>El último resultado bueno de un conjunto, legible sin conexión a los orígenes.</summary>
public sealed record ReportSnapshotDto
{
    public required Guid DatasetId { get; init; }

    /// <summary>La versión de la definición con la que se leyó.</summary>
    public required long DefinitionVersion { get; init; }

    /// <summary>Se leyó con una definición anterior a la que hay guardada ahora.</summary>
    public required bool FromOlderDefinition { get; init; }
    public required DateTimeOffset StartedAtUtc { get; init; }
    public required DateTimeOffset CompletedAtUtc { get; init; }
    public required IReadOnlyList<ResultColumn> Columns { get; init; }
    public required IReadOnlyList<IReadOnlyList<object?>> Rows { get; init; }
    public int UnmatchedLeftRows { get; init; }
    public int UnmatchedRightRows { get; init; }
    public required IReadOnlyList<string> RepeatedColumns { get; init; }
}

public sealed record SavedReportDto
{
    /// <summary>En las peticiones manda el de la ruta.</summary>
    public Guid Id { get; init; }
    public required Guid DatasetId { get; init; }
    public required string Name { get; init; }

    /// <summary>`Table`, `Bar`, `Line` o `Indicator`.</summary>
    public required string Visual { get; init; }

    /// <summary>JSON con campos, agregación y apariencia; su forma la decide la interfaz.</summary>
    public required string Settings { get; init; }
    public DateTimeOffset CreatedAtUtc { get; init; }
    public DateTimeOffset UpdatedAtUtc { get; init; }
}

public sealed record ReportDashboardDto
{
    /// <summary>En las peticiones manda el de la ruta.</summary>
    public Guid Id { get; init; }
    public required string Name { get; init; }

    /// <summary>JSON con páginas, paneles y filtros; su forma la decide la interfaz.</summary>
    public required string Model { get; init; }
    public DateTimeOffset CreatedAtUtc { get; init; }
    public DateTimeOffset UpdatedAtUtc { get; init; }
}

public sealed record ReportTemplateDto
{
    /// <summary>En las peticiones manda el de la ruta.</summary>
    public Guid Id { get; init; }
    public required string Name { get; init; }
    public string? Description { get; init; }

    /// <summary>`Report`, `Panel` o `Dashboard`.</summary>
    public required string Scope { get; init; }

    /// <summary>JSON con el diseño y los campos lógicos; nunca SQL, conexiones ni filas.</summary>
    public required string Model { get; init; }
    public DateTimeOffset CreatedAtUtc { get; init; }
    public DateTimeOffset UpdatedAtUtc { get; init; }
}

/// <summary>Un tablero o un panel para escribir en Excel, calculado por la interfaz con los filtros activos.</summary>
public sealed record ReportExportRequestDto
{
    public required string Title { get; init; }
    public DateTimeOffset GeneratedAtUtc { get; init; }
    public required IReadOnlyList<ReportExportFilterDto> Filters { get; init; }
    public required IReadOnlyList<ReportExportPanelDto> Panels { get; init; }
    public required IReadOnlyList<ReportExportDatasetDto> Datasets { get; init; }
    public required ReportExportLabels Labels { get; init; }
}

public sealed record ReportExportFilterDto(string Label, string Value);

public sealed record ReportExportColumnDto(string Name, string Type);

/// <summary>Filas con los valores tal como los serializa el resultado guardado: números, texto ISO, booleanos o null.</summary>
public sealed record ReportExportTableDto(
    IReadOnlyList<ReportExportColumnDto> Columns,
    IReadOnlyList<IReadOnlyList<System.Text.Json.JsonElement>> Rows);

public sealed record ReportExportPanelDto
{
    public required string Title { get; init; }
    public string? Description { get; init; }
    public required string Page { get; init; }
    public int Dataset { get; init; }
    public required ReportExportTableDto Figures { get; init; }

    /// <summary>`Bar`, `Line` o vacío.</summary>
    public string? Chart { get; init; }
    public string? Color { get; init; }
    public IReadOnlyList<string>? Notes { get; init; }
    public ReportExportIndicator? Indicator { get; init; }
}

public sealed record ReportExportDatasetDto(string Name, DateTimeOffset CapturedAtUtc, ReportExportTableDto Table);

internal static class ReportRunContractMapper
{
    /// <summary>
    /// Pasa la petición al modelo tipado. Un valor que no encaja con su
    /// columna (texto en una de números) se escribe como texto: el archivo no
    /// pierde el dato aunque la interfaz se haya equivocado de tipo.
    /// </summary>
    public static ReportExportDocument ToDomain(this ReportExportRequestDto request) => new()
    {
        Title = request.Title,
        GeneratedAtUtc = request.GeneratedAtUtc,
        Filters = request.Filters.Select(filter => new ReportExportFilter(filter.Label, filter.Value)).ToArray(),
        Panels = request.Panels.Select(panel => new ReportExportPanel
        {
            Title = panel.Title,
            Description = panel.Description,
            Page = panel.Page,
            Dataset = panel.Dataset,
            Figures = panel.Figures.ToDomain(),
            Chart = Enum.TryParse<ReportExportChart>(panel.Chart, ignoreCase: true, out var chart)
                && !int.TryParse(panel.Chart, out _) ? chart : ReportExportChart.None,
            Color = panel.Color,
            Notes = panel.Notes ?? [],
            Indicator = panel.Indicator,
        }).ToArray(),
        Datasets = request.Datasets.Select(dataset => new ReportExportDataset(dataset.Name, dataset.CapturedAtUtc, dataset.Table.ToDomain())).ToArray(),
        Labels = request.Labels,
    };

    private static ReportExportTable ToDomain(this ReportExportTableDto table)
    {
        var columns = table.Columns
            .Select(column => new ReportExportColumn(
                column.Name,
                Enum.TryParse<ReportExportCellType>(column.Type, ignoreCase: true, out var type) && !int.TryParse(column.Type, out _)
                    ? type
                    : ReportExportCellType.Text))
            .ToArray();

        return new ReportExportTable(
            columns,
            table.Rows.Select(row => (IReadOnlyList<object?>)row
                .Select((value, index) => index < columns.Length ? Typed(value, columns[index].Type) : null)
                .ToArray()).ToArray());
    }

    private static object? Typed(System.Text.Json.JsonElement value, ReportExportCellType type)
    {
        switch (value.ValueKind)
        {
            case System.Text.Json.JsonValueKind.Null or System.Text.Json.JsonValueKind.Undefined:
                return null;
            case System.Text.Json.JsonValueKind.True or System.Text.Json.JsonValueKind.False:
                return value.GetBoolean();
            case System.Text.Json.JsonValueKind.Number:
                return value.TryGetDecimal(out var number) ? number : value.GetDouble();
            case System.Text.Json.JsonValueKind.String:
                var text = value.GetString()!;
                // Fechas en ISO: el día solo es una fecha; con hora, un instante en hora local de quien exporta.
                if (type == ReportExportCellType.Date && DateOnly.TryParseExact(text.Length >= 10 ? text[..10] : text, "yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var day))
                {
                    return day.ToDateTime(TimeOnly.MinValue);
                }

                if (type == ReportExportCellType.DateTime && DateTimeOffset.TryParse(text, System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.AssumeUniversal, out var instant))
                {
                    // Con zona (`Z`, `+02:00`, `-05:00`) es un instante: se lleva a la hora local.
                    // Sin ella es una fecha y hora de pared, y se escribe tal cual.
                    var zoned = text.EndsWith('Z') || System.Text.RegularExpressions.Regex.IsMatch(text, @"[+-]\d{2}:?\d{2}$");
                    return zoned ? instant.ToLocalTime().DateTime : instant.DateTime;
                }

                if (type is ReportExportCellType.Number or ReportExportCellType.Percent
                    && decimal.TryParse(text, System.Globalization.NumberStyles.Number, System.Globalization.CultureInfo.InvariantCulture, out var parsed))
                {
                    return parsed;
                }

                return text;
            default:
                return value.GetRawText();
        }
    }

    public static ReportTemplateDto ToDto(this ReportTemplate template) => new()
    {
        Id = template.Id,
        Name = template.Name,
        Description = template.Description,
        Scope = template.Scope.ToString(),
        Model = template.Model,
        CreatedAtUtc = template.CreatedAtUtc,
        UpdatedAtUtc = template.UpdatedAtUtc,
    };

    public static ReportDashboardDto ToDto(this ReportDashboard dashboard) => new()
    {
        Id = dashboard.Id,
        Name = dashboard.Name,
        Model = dashboard.Model,
        CreatedAtUtc = dashboard.CreatedAtUtc,
        UpdatedAtUtc = dashboard.UpdatedAtUtc,
    };

    public static ReportStorageDto ToDto(this ReportStorageUsage usage) => new(
        usage.FileBytes,
        usage.SnapshotBytes,
        usage.QuotaBytes,
        usage.Datasets
            .Select(entry => new ReportStorageEntryDto(
                entry.DatasetId, entry.Name, entry.SnapshotBytes, entry.RunCount, entry.CapturedAtUtc))
            .ToArray());

    public static ReportScheduleDto ToDto(this ReportSchedule schedule) => new()
    {
        Frequency = schedule.Rule.Frequency.ToString(),
        Time = schedule.Rule.Time.ToString("HH:mm", CultureInfo.InvariantCulture),
        Days = schedule.Rule.Frequency == ReportScheduleFrequency.Weekly
            ? schedule.Rule.Days.Select(day => day.ToString()).ToArray()
            : [],
        TimeZone = schedule.Rule.TimeZoneId,
        Paused = schedule.Paused,
        NextRunUtc = schedule.Paused ? null : schedule.NextRunUtc,
        RetryAtUtc = schedule.Paused ? null : schedule.RetryAtUtc,
        Running = schedule.RunningSlotUtc is not null,
    };

    /// <summary>La regla pedida, o el motivo por el que no se puede programar.</summary>
    public static (ReportScheduleRule? Rule, string? Problem) ToRule(this ReportScheduleDto dto)
    {
        if (int.TryParse(dto.Frequency, out _)
            || !Enum.TryParse<ReportScheduleFrequency>(dto.Frequency, ignoreCase: true, out var frequency)
            || !Enum.IsDefined(frequency))
        {
            return (null, "La frecuencia es diaria o semanal.");
        }

        if (!TimeOnly.TryParseExact(dto.Time, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out var time))
        {
            return (null, "La hora va en formato HH:mm.");
        }

        var days = new List<DayOfWeek>();
        foreach (var name in dto.Days ?? [])
        {
            if (int.TryParse(name, out _) || !Enum.TryParse<DayOfWeek>(name, ignoreCase: true, out var day))
            {
                return (null, $"«{name}» no es un día de la semana.");
            }

            if (!days.Contains(day))
            {
                days.Add(day);
            }
        }

        var rule = new ReportScheduleRule(
            frequency, time, frequency == ReportScheduleFrequency.Weekly ? days : [], dto.TimeZone?.Trim() ?? string.Empty);
        return ReportScheduleCalendar.Validate(rule) is { } problem ? (null, problem) : (rule, null);
    }

    public static ReportRunDto ToDto(this ReportRun run) => new()
    {
        Id = run.Id,
        DefinitionVersion = run.DefinitionVersion,
        Origin = run.Origin.ToString(),
        Status = run.Status.ToString(),
        StartedAtUtc = run.StartedAtUtc,
        CompletedAtUtc = run.CompletedAtUtc,
        Message = run.Message,
        DuplicateKeys = run.DuplicateKeys,
        RowCount = run.RowCount,
        Sources = run.Sources
            .Select(source => new ReportRunSourceDto(source.Alias, source.FailureCode, source.Message,
                source.RowCount, source.Truncated, source.StartedAtUtc, source.CompletedAtUtc))
            .ToArray(),
    };

    public static ReportSnapshotDto ToDto(this ReportSnapshot snapshot, long currentVersion) => new()
    {
        DatasetId = snapshot.DatasetId,
        DefinitionVersion = snapshot.DefinitionVersion,
        FromOlderDefinition = snapshot.DefinitionVersion < currentVersion,
        StartedAtUtc = snapshot.Window.StartedAtUtc,
        CompletedAtUtc = snapshot.Window.CompletedAtUtc,
        Columns = snapshot.Result.Columns,
        Rows = snapshot.Result.Rows,
        UnmatchedLeftRows = snapshot.Result.UnmatchedLeftRows,
        UnmatchedRightRows = snapshot.Result.UnmatchedRightRows,
        RepeatedColumns = snapshot.Result.RepeatedColumns,
    };

    public static SavedReportDto ToDto(this SavedReport report) => new()
    {
        Id = report.Id,
        DatasetId = report.DatasetId,
        Name = report.Name,
        Visual = report.Visual.ToString(),
        Settings = report.Settings,
        CreatedAtUtc = report.CreatedAtUtc,
        UpdatedAtUtc = report.UpdatedAtUtc,
    };
}
