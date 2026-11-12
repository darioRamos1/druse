using Druse.Application.Reports;

namespace Druse.Application.Abstractions;

/// <summary>Definiciones de los conjuntos de datos de BI.</summary>
public interface IReportDatasetStore
{
    /// <summary>Todas, por lo último que se tocó.</summary>
    Task<IReadOnlyList<ReportDataset>> GetAllAsync(CancellationToken cancellationToken);

    Task<ReportDataset?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Crea o reemplaza la definición. La versión la pone el almacén: sube solo
    /// si cambian las fuentes o la unión, no al renombrar.
    /// </summary>
    Task<ReportDataset> SaveAsync(ReportDataset dataset, CancellationToken cancellationToken);

    /// <summary>Borra la definición y su resultado guardado.</summary>
    Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}
