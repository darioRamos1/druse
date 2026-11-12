using Druse.Application.Reports;

namespace Druse.Application.Abstractions;

public interface IReportSnapshotStore
{
    Task<ReportSnapshot?> FindAsync(Guid datasetId, CancellationToken cancellationToken);

    /// <summary>Publica el resultado si es más reciente que el que ya está disponible.</summary>
    Task<bool> SaveAsync(ReportSnapshot snapshot, CancellationToken cancellationToken);

    /// <summary>
    /// Borra el resultado guardado de un conjunto y devuelve el espacio al disco.
    /// La definición, sus reportes, su programación y su historial se quedan.
    /// </summary>
    Task<bool> DeleteAsync(Guid datasetId, CancellationToken cancellationToken);

    /// <summary>Cuánto ocupa Reportes BI en disco y cuánto cada conjunto.</summary>
    Task<ReportStorageUsage> GetUsageAsync(CancellationToken cancellationToken);
}
