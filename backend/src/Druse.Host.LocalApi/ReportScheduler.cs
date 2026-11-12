using Druse.Application.Reports;

namespace Druse.Host.LocalApi;

/// <summary>
/// Lanza las actualizaciones programadas de Reportes mientras Druse está abierto.
///
/// Al arrancar recoge lo que quedó a medias; después mira cada pocos segundos
/// qué ha vencido. Mirar a menudo no cuesta nada —es una lectura de SQLite— y
/// hace que, al despertar el equipo, la actualización pendiente salga enseguida
/// en vez de esperar a un temporizador largo.
///
/// Cada actualización corre en su propio scope, como los trabajos de la cola:
/// usa conexiones y llavero que no pueden vivir lo que vive el proceso.
/// </summary>
internal sealed class ReportScheduler(
    ReportScheduleDispatcher dispatcher,
    IServiceScopeFactory scopes,
    IConfiguration configuration,
    TimeProvider clock,
    ILogger<ReportScheduler> logger) : BackgroundService
{
    /// <summary>
    /// Cada cuánto se mira. Se puede acortar con `Reports:ScheduleTickSeconds`
    /// para comprobar un horario de verdad sin esperar.
    /// </summary>
    private static readonly TimeSpan DefaultInterval = TimeSpan.FromSeconds(20);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            var recovered = await dispatcher.RecoverAsync(stoppingToken);
            if (recovered > 0 && logger.IsEnabled(LogLevel.Information))
            {
                logger.LogInformation(
                    "{Count} actualización(es) programada(s) quedaron a medias al cerrar Druse.", recovered);
            }
        }
        catch (Exception exception) when (!stoppingToken.IsCancellationRequested)
        {
            logger.LogWarning(exception, "No se pudo revisar la programación de Reportes al arrancar.");
        }

        var seconds = configuration.GetValue<double?>("Reports:ScheduleTickSeconds");
        using var timer = new PeriodicTimer(
            seconds is > 0 ? TimeSpan.FromSeconds(seconds.Value) : DefaultInterval, clock);

        do
        {
            try
            {
                await dispatcher.TickAsync(RefreshAsync, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                // Un horario que se rompe no puede llevarse los demás ni los siguientes.
                logger.LogWarning(exception, "No se pudo despachar la programación de Reportes.");
            }
        }
        while (await timer.WaitForNextTickAsync(stoppingToken));
    }

    private async Task<ReportRefreshResult> RefreshAsync(Guid datasetId, CancellationToken cancellationToken)
    {
        await using var scope = scopes.CreateAsyncScope();
        var refresher = scope.ServiceProvider.GetRequiredService<ReportRefreshService>();
        return await refresher.RefreshAsync(datasetId, ReportRunOrigin.Scheduled, cancellationToken);
    }
}
