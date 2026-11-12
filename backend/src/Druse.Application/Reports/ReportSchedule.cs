namespace Druse.Application.Reports;

public enum ReportScheduleFrequency
{
    Daily,
    Weekly,
}

/// <summary>
/// Cuándo se actualiza solo un conjunto de datos: a una hora de una zona, todos
/// los días o los días de la semana elegidos.
///
/// La hora se guarda como hora local de su zona, no en UTC: «a las 7:00 de
/// Bogotá» sigue siendo a las 7:00 cuando cambia el horario de verano, que es lo
/// que espera quien lo programó.
/// </summary>
public sealed record ReportScheduleRule(
    ReportScheduleFrequency Frequency,
    TimeOnly Time,
    IReadOnlyList<DayOfWeek> Days,
    string TimeZoneId);

/// <summary>
/// La programación de un conjunto y su estado de despacho.
///
/// <see cref="NextRunUtc"/> es el próximo horario; <see cref="RunningSlotUtc"/>
/// dice que hay uno reclamado y en marcha. Si Druse se cierra con él puesto, al
/// volver a abrir se sabe que aquella actualización no terminó.
/// </summary>
public sealed record ReportSchedule
{
    public required Guid DatasetId { get; init; }

    public required ReportScheduleRule Rule { get; init; }

    /// <summary>En pausa no se despacha nada; «Actualizar ahora» sigue funcionando.</summary>
    public bool Paused { get; init; }

    public required DateTimeOffset NextRunUtc { get; init; }

    /// <summary>Reintentos ya usados por el horario en curso.</summary>
    public int Attempt { get; init; }

    /// <summary>Cuándo toca el reintento, si un fallo pasajero lo dejó pendiente.</summary>
    public DateTimeOffset? RetryAtUtc { get; init; }

    public DateTimeOffset? RunningSlotUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }
}

/// <summary>Las cuentas del calendario, sin reloj ni almacén: así se prueban con cualquier fecha.</summary>
public static class ReportScheduleCalendar
{
    /// <summary>
    /// Valida la regla. Devuelve el problema, o null si se puede programar.
    /// </summary>
    public static string? Validate(ReportScheduleRule rule)
    {
        ArgumentNullException.ThrowIfNull(rule);

        if (!Enum.IsDefined(rule.Frequency))
        {
            return "La frecuencia es diaria o semanal.";
        }

        if (rule.Frequency == ReportScheduleFrequency.Weekly
            && (rule.Days.Count == 0 || rule.Days.Any(day => !Enum.IsDefined(day))))
        {
            return "Una programación semanal necesita al menos un día.";
        }

        return FindZone(rule.TimeZoneId) is null ? "No se reconoce esa zona horaria." : null;
    }

    /// <summary>
    /// El primer horario estrictamente posterior a <paramref name="afterUtc"/>.
    ///
    /// Se calcula siempre desde «ahora», nunca desde el horario anterior: si
    /// Druse estuvo cerrado tres días, los horarios perdidos no se encadenan uno
    /// detrás de otro, se salta al siguiente.
    /// </summary>
    public static DateTimeOffset NextAfter(ReportScheduleRule rule, DateTimeOffset afterUtc)
    {
        ArgumentNullException.ThrowIfNull(rule);
        var zone = FindZone(rule.TimeZoneId)
            ?? throw new ArgumentException("No se reconoce esa zona horaria.", nameof(rule));
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(afterUtc, zone).DateTime);

        // Hoy (si la hora no ha pasado) y los siete días siguientes cubren
        // cualquier semana, también la de un solo día marcado.
        for (var offset = 0; offset <= 8; offset++)
        {
            var date = today.AddDays(offset);
            if (rule.Frequency == ReportScheduleFrequency.Weekly && !rule.Days.Contains(date.DayOfWeek))
            {
                continue;
            }

            var candidate = ToUtc(date.ToDateTime(rule.Time), zone);
            if (candidate > afterUtc)
            {
                return candidate;
            }
        }

        throw new InvalidOperationException("No se encontró el siguiente horario.");
    }

    /// <summary>
    /// Pasa una hora local a UTC con los cambios de horario resueltos.
    ///
    /// Una hora que no existe —el salto de primavera— se corre hacia delante
    /// hasta la primera que sí. Una que existe dos veces —el retroceso de
    /// otoño— toma la primera: así el mismo día no se ejecuta dos veces.
    /// </summary>
    private static DateTimeOffset ToUtc(DateTime local, TimeZoneInfo zone)
    {
        for (var guard = 0; zone.IsInvalidTime(local) && guard < 240; guard++)
        {
            local = local.AddMinutes(1);
        }

        var offset = zone.IsAmbiguousTime(local)
            ? zone.GetAmbiguousTimeOffsets(local).Max()
            : zone.GetUtcOffset(local);
        return new DateTimeOffset(local, offset).ToUniversalTime();
    }

    private static TimeZoneInfo? FindZone(string? id) =>
        !string.IsNullOrWhiteSpace(id) && TimeZoneInfo.TryFindSystemTimeZoneById(id, out var zone) ? zone : null;
}
