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

/// <summary>Lo que ocupa un conjunto: su resultado guardado y su historial de intentos.</summary>
public sealed record ReportStorageEntry(
    Guid DatasetId,
    string Name,
    long SnapshotBytes,
    int RunCount,
    DateTimeOffset? CapturedAtUtc);

/// <summary>
/// El espacio de Reportes BI. <see cref="SnapshotBytes"/> es lo que cuenta para
/// la cuota; <see cref="FileBytes"/> es el archivo entero, con definiciones,
/// historial y el hueco que SQLite todavía no ha devuelto.
/// </summary>
public sealed record ReportStorageUsage(
    long FileBytes,
    long SnapshotBytes,
    long QuotaBytes,
    IReadOnlyList<ReportStorageEntry> Datasets);

/// <summary>Límites de lo que se guarda en reports.db.</summary>
public static class ReportStorage
{
    /// <summary>
    /// Cuota para todos los resultados guardados juntos. Cada uno ya está
    /// acotado a 32 MiB; esto evita que veinte conjuntos llenen el disco sin
    /// que nadie lo note.
    /// </summary>
    public const long QuotaBytes = 512L * 1024 * 1024;

    /// <summary>Un intento más viejo que esto se olvida, aunque quepa en los 20.</summary>
    public static readonly TimeSpan RunRetention = TimeSpan.FromDays(90);
}
