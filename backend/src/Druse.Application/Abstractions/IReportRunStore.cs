using Druse.Application.Reports;

namespace Druse.Application.Abstractions;

/// <summary>Intentos de actualización de los conjuntos de datos, acotados por conjunto.</summary>
public interface IReportRunStore
{
    /// <summary>Guarda el intento y olvida los más viejos del mismo conjunto.</summary>
    Task AddAsync(ReportRun run, CancellationToken cancellationToken);

    /// <summary>Los más recientes primero.</summary>
    Task<IReadOnlyList<ReportRun>> GetRecentAsync(Guid datasetId, int limit, CancellationToken cancellationToken);
}

/// <summary>Reportes guardados sobre los conjuntos de datos.</summary>
public interface ISavedReportStore
{
    Task<IReadOnlyList<SavedReport>> GetByDatasetAsync(Guid datasetId, CancellationToken cancellationToken);

    Task<SavedReport?> FindAsync(Guid id, CancellationToken cancellationToken);

    Task<SavedReport> SaveAsync(SavedReport report, CancellationToken cancellationToken);

    Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}
