using Druse.Application.Reports;

namespace Druse.Application.Abstractions;

public interface IReportSnapshotStore
{
    Task<ReportSnapshot?> FindAsync(Guid datasetId, CancellationToken cancellationToken);

    /// <summary>Publica el resultado si es más reciente que el que ya está disponible.</summary>
    Task<bool> SaveAsync(ReportSnapshot snapshot, CancellationToken cancellationToken);
}
