namespace Druse.Application.Reports;

public sealed record ReportDatasetJoin(
    Guid DatasetId,
    long DefinitionVersion,
    IReadOnlyList<ReportJoinKey> Keys,
    ReportJoinKind Kind);

public sealed record ReportReadWindow(DateTimeOffset StartedAtUtc, DateTimeOffset CompletedAtUtc);

/// <summary>Último resultado publicado de un conjunto de datos.</summary>
public sealed record ReportSnapshot(
    Guid DatasetId,
    long DefinitionVersion,
    ReportReadWindow Window,
    ReportJoinResult Result);
