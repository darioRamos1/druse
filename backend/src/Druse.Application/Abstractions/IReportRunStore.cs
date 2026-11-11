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
    /// <summary>Todos, para elegir qué va en un tablero.</summary>
    Task<IReadOnlyList<SavedReport>> GetAllAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<SavedReport>> GetByDatasetAsync(Guid datasetId, CancellationToken cancellationToken);

    Task<SavedReport?> FindAsync(Guid id, CancellationToken cancellationToken);

    Task<SavedReport> SaveAsync(SavedReport report, CancellationToken cancellationToken);

    Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}

/// <summary>Tableros de reportes.</summary>
public interface IReportDashboardStore
{
    Task<IReadOnlyList<ReportDashboard>> GetAllAsync(CancellationToken cancellationToken);

    Task<ReportDashboard> SaveAsync(ReportDashboard dashboard, CancellationToken cancellationToken);

    Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}
