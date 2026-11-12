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

/// <summary>Plantillas de diseño: reportes, paneles y tableros reutilizables.</summary>
public interface IReportTemplateStore
{
    Task<IReadOnlyList<ReportTemplate>> GetAllAsync(CancellationToken cancellationToken);

    Task<ReportTemplate> SaveAsync(ReportTemplate reportTemplate, CancellationToken cancellationToken);

    Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}

/// <summary>Escribe un tablero o un panel de Reportes en un libro de Excel.</summary>
public interface IReportWorkbookWriter
{
    /// <summary>El libro entero, en memoria: el tope de celdas ya lo acota.</summary>
    byte[] Write(ReportExportDocument document);
}

/// <summary>
/// Programaciones de actualización, una por conjunto de datos.
///
/// Reclamar y completar son escrituras condicionadas: es lo que garantiza que un
/// horario se despache una sola vez aunque dos despachos lo vean vencido.
/// </summary>
public interface IReportScheduleStore
{
    Task<IReadOnlyList<ReportSchedule>> GetAllAsync(CancellationToken cancellationToken);

    Task<ReportSchedule?> FindAsync(Guid datasetId, CancellationToken cancellationToken);

    /// <summary>
    /// Crea o cambia la regla. Olvida el reintento pendiente; si hay una
    /// actualización en marcha, la deja terminar.
    /// </summary>
    Task<ReportSchedule> SaveAsync(ReportSchedule schedule, CancellationToken cancellationToken);

    Task DeleteAsync(Guid datasetId, CancellationToken cancellationToken);

    /// <summary>
    /// Reclama un horario si sigue tal como se leyó: mismo próximo horario, mismo
    /// reintento, sin pausa y sin nada en marcha. Lo deja en marcha en <paramref name="slotUtc"/>
    /// y con <paramref name="nextRunUtc"/> como siguiente.
    /// </summary>
    Task<bool> TryClaimAsync(
        ReportSchedule seen, DateTimeOffset nextRunUtc, DateTimeOffset slotUtc, CancellationToken cancellationToken);

    /// <summary>Cierra el horario en marcha <paramref name="slotUtc"/> y anota el reintento, si lo hay.</summary>
    Task<bool> CompleteAsync(
        Guid datasetId, DateTimeOffset slotUtc, DateTimeOffset? retryAtUtc, int attempt,
        CancellationToken cancellationToken);
}
