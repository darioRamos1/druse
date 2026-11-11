namespace Druse.Application.Reports;

public enum ReportRunOrigin
{
    Manual,
    Scheduled,
}

public enum ReportRunStatus
{
    Succeeded,
    Failed,
    Canceled,
}

/// <summary>Qué pasó con una fuente en una ejecución.</summary>
public sealed record ReportRunSource(
    string Alias,
    string? FailureCode,
    string? Message,
    int RowCount,
    bool Truncated,
    DateTimeOffset StartedAtUtc,
    DateTimeOffset CompletedAtUtc);

/// <summary>
/// Un intento de actualizar un conjunto de datos.
///
/// Se guarda también cuando falla: es lo que permite decir «datos del martes,
/// el intento de hoy falló porque…» en vez de dejar al usuario mirando cifras
/// viejas sin saberlo.
/// </summary>
public sealed record ReportRun
{
    public required Guid Id { get; init; }

    public required Guid DatasetId { get; init; }

    public required long DefinitionVersion { get; init; }

    public required ReportRunOrigin Origin { get; init; }

    public required ReportRunStatus Status { get; init; }

    public required DateTimeOffset StartedAtUtc { get; init; }

    public required DateTimeOffset CompletedAtUtc { get; init; }

    /// <summary>Por qué falló, si falló.</summary>
    public string? Message { get; init; }

    /// <summary>Claves repetidas que detuvieron la unión, para buscarlas en el origen.</summary>
    public IReadOnlyList<string> DuplicateKeys { get; init; } = [];

    public int RowCount { get; init; }

    public IReadOnlyList<ReportRunSource> Sources { get; init; } = [];
}

/// <summary>
/// Un reporte guardado: una forma de mirar el resultado de un conjunto de datos.
///
/// `Settings` es JSON y su forma la decide la interfaz —campos, agregación,
/// colores—, como el modelo de las composiciones: aquí solo se exige que exista.
/// </summary>
public sealed record SavedReport
{
    public required Guid Id { get; init; }

    public required Guid DatasetId { get; init; }

    public required string Name { get; init; }

    public required ReportVisualKind Visual { get; init; }

    public required string Settings { get; init; }

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }
}

public enum ReportVisualKind
{
    Table,
    Bar,
    Line,
    Indicator,
}
