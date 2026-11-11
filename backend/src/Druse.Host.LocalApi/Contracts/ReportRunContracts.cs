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

    /// <summary>`Succeeded`, `Failed` o `Canceled`.</summary>
    public required string Status { get; init; }
    public required DateTimeOffset StartedAtUtc { get; init; }
    public required DateTimeOffset CompletedAtUtc { get; init; }
    public string? Message { get; init; }
    public required IReadOnlyList<string> DuplicateKeys { get; init; }
    public int RowCount { get; init; }
    public required IReadOnlyList<ReportRunSourceDto> Sources { get; init; }
}

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

internal static class ReportRunContractMapper
{
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
