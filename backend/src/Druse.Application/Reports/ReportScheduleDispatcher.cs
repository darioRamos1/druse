using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Application.Reports;

/// <summary>
/// Despacha las actualizaciones programadas que tocan.
///
/// Lo llama un servicio de la API cada pocos segundos mientras Druse está
/// abierto. No sabe nada de temporizadores: mira el reloj, reclama lo que vence
/// y ejecuta la misma actualización que «Actualizar ahora». Por eso el reloj,
/// la suspensión y el arranque tardío se prueban moviendo un <see cref="TimeProvider"/>.
///
/// Reglas:
///
/// - **Cada horario se ejecuta a lo sumo una vez.** El horario se reclama con
///   una escritura condicionada en SQLite: si dos despachos lo ven vencido a la
///   vez, solo uno gana.
/// - **Los horarios perdidos no se acumulan.** Con Druse cerrado o el equipo
///   suspendido, al volver se hace una sola actualización y el siguiente
///   horario se calcula desde ahora.
/// - **Un fallo pasajero se reintenta una vez**, a los cinco minutos. Una
///   fuente sin contraseña, una consulta inválida o claves duplicadas no se
///   arreglan solas y no se reintentan.
/// - Si «Actualizar ahora» está en marcha, el horario espera un minuto y vuelve
///   a probar: no son dos lecturas del mismo origen a la vez.
/// </summary>
public sealed class ReportScheduleDispatcher(
    IReportScheduleStore schedules,
    IReportRunStore runs,
    TimeProvider clock)
{
    /// <summary>Reintentos por horario tras un fallo pasajero.</summary>
    public const int MaxRetries = 1;

    public static readonly TimeSpan RetryDelay = TimeSpan.FromMinutes(5);

    /// <summary>Espera cuando el conjunto ya se está actualizando a mano.</summary>
    public static readonly TimeSpan BusyDelay = TimeSpan.FromMinutes(1);

    /// <summary>
    /// Al arrancar: lo que quedó reclamado es una actualización que Druse no
    /// llegó a terminar. Se anota como interrumpida y se reintenta enseguida,
    /// si le queda reintento.
    /// </summary>
    public async Task<int> RecoverAsync(CancellationToken cancellationToken)
    {
        var now = clock.GetUtcNow();
        var recovered = 0;
        foreach (var schedule in await schedules.GetAllAsync(cancellationToken))
        {
            if (schedule.RunningSlotUtc is not { } slot)
            {
                continue;
            }

            var retry = schedule.Attempt < MaxRetries && !schedule.Paused;
            if (!await schedules.CompleteAsync(
                    schedule.DatasetId, slot, retry ? now : null, retry ? schedule.Attempt + 1 : 0, cancellationToken))
            {
                continue;
            }

            await runs.AddAsync(new ReportRun
            {
                Id = Guid.NewGuid(),
                DatasetId = schedule.DatasetId,
                DefinitionVersion = 0,
                Origin = ReportRunOrigin.Scheduled,
                Status = ReportRunStatus.Interrupted,
                StartedAtUtc = slot,
                CompletedAtUtc = now,
                Message = ReportMessages.Interrupted().Text,
                Localized = ReportMessages.Interrupted(),
            }, cancellationToken);
            recovered++;
        }

        return recovered;
    }

    /// <summary>
    /// Despacha lo que haya vencido y dice cuántas actualizaciones lanzó.
    /// </summary>
    /// <param name="refresh">
    /// La actualización en sí. La pone quien llama porque necesita servicios
    /// con su propio scope —conexiones, llavero— que aquí no pintan nada.
    /// </param>
    public async Task<int> TickAsync(
        Func<Guid, CancellationToken, Task<ReportRefreshResult>> refresh,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(refresh);
        var dispatched = 0;
        foreach (var schedule in await schedules.GetAllAsync(cancellationToken))
        {
            if (await TryDispatchAsync(schedule, refresh, cancellationToken))
            {
                dispatched++;
            }
        }

        return dispatched;
    }

    private async Task<bool> TryDispatchAsync(
        ReportSchedule schedule,
        Func<Guid, CancellationToken, Task<ReportRefreshResult>> refresh,
        CancellationToken cancellationToken)
    {
        if (schedule.Paused || schedule.RunningSlotUtc is not null)
        {
            return false;
        }

        var now = clock.GetUtcNow();
        var due = schedule.NextRunUtc <= now;
        var retryDue = schedule.RetryAtUtc is { } retryAt && retryAt <= now;
        if (!due && !retryDue)
        {
            return false;
        }

        // Un horario nuevo manda sobre el reintento del anterior: los datos que
        // traiga son igual de frescos y no hace falta leer dos veces.
        var slot = due ? schedule.NextRunUtc : schedule.RetryAtUtc!.Value;
        var attempt = due ? 0 : schedule.Attempt;
        var next = due ? ReportScheduleCalendar.NextAfter(schedule.Rule, now) : schedule.NextRunUtc;
        if (!await schedules.TryClaimAsync(schedule, next, slot, cancellationToken))
        {
            return false;
        }

        ReportRefreshResult result;
        try
        {
            result = await refresh(schedule.DatasetId, cancellationToken);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Druse se apaga: el intento ya quedó anotado como cancelado y el
            // horario se repite en cuanto vuelva a abrirse.
            await schedules.CompleteAsync(schedule.DatasetId, slot, now, attempt, CancellationToken.None);
            throw;
        }
        catch (Exception) when (!cancellationToken.IsCancellationRequested)
        {
            // Algo que la actualización no esperaba: se trata como pasajero.
            result = new ReportRefreshResult(ReportRefreshOutcome.Failed, null);
        }

        var finished = clock.GetUtcNow();
        switch (result.Outcome)
        {
            case ReportRefreshOutcome.NotFound:
                await schedules.DeleteAsync(schedule.DatasetId, CancellationToken.None);
                break;
            case ReportRefreshOutcome.Busy:
                await schedules.CompleteAsync(
                    schedule.DatasetId, slot, finished + BusyDelay, attempt, CancellationToken.None);
                break;
            case ReportRefreshOutcome.Failed when IsTransient(result.Run) && attempt < MaxRetries:
                await schedules.CompleteAsync(
                    schedule.DatasetId, slot, finished + RetryDelay, attempt + 1, CancellationToken.None);
                break;
            default:
                await schedules.CompleteAsync(schedule.DatasetId, slot, null, 0, CancellationToken.None);
                break;
        }

        return true;
    }

    /// <summary>
    /// Un fallo que puede arreglarse solo: una base que no respondió.
    /// Sin intento anotado es que la actualización se rompió por dentro.
    /// </summary>
    public static bool IsTransient(ReportRun? run) =>
        run is null
        || (run.DuplicateKeys.Count == 0
            && run.Sources.Any(source => source.FailureCode == ReportSourceFailure.DatabaseError));
}
