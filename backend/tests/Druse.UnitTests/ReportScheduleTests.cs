using Druse.Application.Reports;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// La programación de Reportes con el reloj en la mano: horarios, cambios de
/// hora, arranque tardío, suspensión, dos despachos a la vez, una actualización
/// manual en marcha y fallos de origen. El criterio del hito es que cada horario
/// se ejecute a lo sumo una vez, salvo su reintento.
/// </summary>
public sealed class ReportScheduleTests
{
    private static readonly DateTimeOffset Lunes9 = new(2026, 11, 16, 9, 0, 0, TimeSpan.Zero);
    private static readonly ReportScheduleRule DiariaA7 = new(ReportScheduleFrequency.Daily, new TimeOnly(7, 0), [], "UTC");

    [Fact]
    public void LaDiariaTocaHoySiLaHoraNoHaPasadoYMananaSiYaPaso()
    {
        var a10 = DiariaA7 with { Time = new TimeOnly(10, 0) };

        Assert.Equal(Lunes9.AddHours(1), ReportScheduleCalendar.NextAfter(a10, Lunes9));
        Assert.Equal(Lunes9.AddDays(1).AddHours(-2), ReportScheduleCalendar.NextAfter(DiariaA7, Lunes9));

        // Justo a la hora no vuelve a tocar: el siguiente es mañana.
        Assert.Equal(Lunes9.AddDays(1).AddHours(1), ReportScheduleCalendar.NextAfter(a10, Lunes9.AddHours(1)));
    }

    [Fact]
    public void LaSemanalSaltaALosDiasMarcados()
    {
        var viernes = new ReportScheduleRule(ReportScheduleFrequency.Weekly, new TimeOnly(7, 0), [DayOfWeek.Friday], "UTC");
        var lunesYJueves = viernes with { Days = [DayOfWeek.Monday, DayOfWeek.Thursday] };

        Assert.Equal(new DateTimeOffset(2026, 11, 20, 7, 0, 0, TimeSpan.Zero), ReportScheduleCalendar.NextAfter(viernes, Lunes9));
        Assert.Equal(new DateTimeOffset(2026, 11, 19, 7, 0, 0, TimeSpan.Zero), ReportScheduleCalendar.NextAfter(lunesYJueves, Lunes9));

        // Un solo día y ya pasado hoy: el de la semana que viene.
        var lunes = viernes with { Days = [DayOfWeek.Monday] };
        Assert.Equal(new DateTimeOffset(2026, 11, 23, 7, 0, 0, TimeSpan.Zero), ReportScheduleCalendar.NextAfter(lunes, Lunes9));
    }

    [Fact]
    public void LaHoraLocalSeMantieneConLosCambiosDeHorario()
    {
        var nuevaYork = new ReportScheduleRule(ReportScheduleFrequency.Daily, new TimeOnly(7, 0), [], "America/New_York");

        // 7:00 de Nueva York es 12:00 UTC en invierno y 11:00 UTC en verano.
        Assert.Equal(new DateTimeOffset(2026, 3, 7, 12, 0, 0, TimeSpan.Zero),
            ReportScheduleCalendar.NextAfter(nuevaYork, new DateTimeOffset(2026, 3, 7, 0, 0, 0, TimeSpan.Zero)));
        Assert.Equal(new DateTimeOffset(2026, 3, 9, 11, 0, 0, TimeSpan.Zero),
            ReportScheduleCalendar.NextAfter(nuevaYork, new DateTimeOffset(2026, 3, 9, 0, 0, 0, TimeSpan.Zero)));

        // Las 2:30 del 8 de marzo no existen: se corre a la primera hora que sí.
        var a230 = nuevaYork with { Time = new TimeOnly(2, 30) };
        Assert.Equal(new DateTimeOffset(2026, 3, 8, 7, 0, 0, TimeSpan.Zero),
            ReportScheduleCalendar.NextAfter(a230, new DateTimeOffset(2026, 3, 8, 0, 0, 0, TimeSpan.Zero)));

        // La 1:30 del 1 de noviembre existe dos veces: se toma la primera y ese
        // día no se repite con la segunda.
        var a130 = nuevaYork with { Time = new TimeOnly(1, 30) };
        var primera = ReportScheduleCalendar.NextAfter(a130, new DateTimeOffset(2026, 11, 1, 0, 0, 0, TimeSpan.Zero));
        Assert.Equal(new DateTimeOffset(2026, 11, 1, 5, 30, 0, TimeSpan.Zero), primera);
        Assert.Equal(new DateTimeOffset(2026, 11, 2, 6, 30, 0, TimeSpan.Zero), ReportScheduleCalendar.NextAfter(a130, primera));
    }

    [Fact]
    public void UnaReglaSinDiasOConZonaDesconocidaNoSeAcepta()
    {
        Assert.Null(ReportScheduleCalendar.Validate(DiariaA7));
        Assert.NotNull(ReportScheduleCalendar.Validate(DiariaA7 with { Frequency = ReportScheduleFrequency.Weekly }));
        Assert.NotNull(ReportScheduleCalendar.Validate(DiariaA7 with { TimeZoneId = "Marte/Olympus" }));
        Assert.NotNull(ReportScheduleCalendar.Validate(DiariaA7 with { TimeZoneId = "" }));
    }

    [Fact]
    public async Task CadaHorarioSeEjecutaUnaSolaVez()
    {
        using var escenario = await Escenario.CrearAsync(Lunes9.AddHours(-3));
        Assert.Equal(0, await escenario.TickAsync());

        escenario.Reloj.Set(Lunes9.AddHours(-2).AddSeconds(5));
        Assert.Equal(1, await escenario.TickAsync());
        Assert.Equal(0, await escenario.TickAsync());

        var programada = await escenario.ProgramadaAsync();
        Assert.Equal(Lunes9.AddDays(1).AddHours(-2), programada.NextRunUtc);
        Assert.Null(programada.RunningSlotUtc);
        Assert.Single(escenario.Llamadas);
    }

    [Fact]
    public async Task ConDruseCerradoOSuspendidoVariosDiasSeHaceUnaSolaActualizacion()
    {
        using var escenario = await Escenario.CrearAsync(Lunes9);

        // Tres días sin mirar: al volver, una sola actualización.
        escenario.Reloj.Set(Lunes9.AddDays(3).AddHours(2));
        Assert.Equal(1, await escenario.TickAsync());
        Assert.Equal(0, await escenario.TickAsync());

        // Y el siguiente horario se cuenta desde ahora, no desde el perdido.
        Assert.Equal(Lunes9.AddDays(4).AddHours(-2), (await escenario.ProgramadaAsync()).NextRunUtc);
    }

    [Fact]
    public async Task DosDespachosALaVezNoRepitenElHorario()
    {
        using var escenario = await Escenario.CrearAsync(Lunes9);
        escenario.Reloj.Set(Lunes9.AddDays(1));
        escenario.Demora = TimeSpan.FromMilliseconds(150);
        var otro = new ReportScheduleDispatcher(escenario.Programaciones, escenario.Intentos, escenario.Reloj);

        var lanzadas = await Task.WhenAll(
            escenario.TickAsync(),
            otro.TickAsync(escenario.Actualizar, CancellationToken.None));

        Assert.Equal(1, lanzadas.Sum());
        Assert.Single(escenario.Llamadas);
    }

    [Fact]
    public async Task SiSeEstaActualizandoAManoElHorarioEsperaYVuelveAProbar()
    {
        using var escenario = await Escenario.CrearAsync(Lunes9);
        escenario.Reloj.Set(Lunes9.AddDays(1));
        escenario.Respuestas.Enqueue(new ReportRefreshResult(ReportRefreshOutcome.Busy, null));

        Assert.Equal(1, await escenario.TickAsync());
        var pendiente = await escenario.ProgramadaAsync();
        Assert.Equal(escenario.Reloj.GetUtcNow() + ReportScheduleDispatcher.BusyDelay, pendiente.RetryAtUtc);

        escenario.Reloj.Advance(TimeSpan.FromSeconds(30));
        Assert.Equal(0, await escenario.TickAsync());
        escenario.Reloj.Advance(TimeSpan.FromSeconds(31));
        Assert.Equal(1, await escenario.TickAsync());
        Assert.Null((await escenario.ProgramadaAsync()).RetryAtUtc);
    }

    [Fact]
    public async Task UnFalloDelOrigenSeReintentaUnaSolaVez()
    {
        using var escenario = await Escenario.CrearAsync(Lunes9);
        escenario.Reloj.Set(Lunes9.AddDays(1));
        escenario.Respuestas.Enqueue(Fallo(ReportSourceFailure.DatabaseError));
        escenario.Respuestas.Enqueue(Fallo(ReportSourceFailure.DatabaseError));

        Assert.Equal(1, await escenario.TickAsync());
        var tras1 = await escenario.ProgramadaAsync();
        Assert.Equal(1, tras1.Attempt);
        Assert.NotNull(tras1.RetryAtUtc);

        escenario.Reloj.Advance(ReportScheduleDispatcher.RetryDelay);
        Assert.Equal(1, await escenario.TickAsync());

        // El reintento también falló: ya no hay más hasta el próximo horario.
        var tras2 = await escenario.ProgramadaAsync();
        Assert.Null(tras2.RetryAtUtc);
        Assert.Equal(0, tras2.Attempt);
        escenario.Reloj.Advance(TimeSpan.FromHours(1));
        Assert.Equal(0, await escenario.TickAsync());
        Assert.Equal(2, escenario.Llamadas.Count);
    }

    [Fact]
    public async Task UnFalloQueNoSeArreglaSoloNoSeReintenta()
    {
        using var escenario = await Escenario.CrearAsync(Lunes9);
        escenario.Reloj.Set(Lunes9.AddDays(1));
        escenario.Respuestas.Enqueue(Fallo(ReportSourceFailure.PasswordMissing));

        Assert.Equal(1, await escenario.TickAsync());
        Assert.Null((await escenario.ProgramadaAsync()).RetryAtUtc);
        Assert.False(ReportScheduleDispatcher.IsTransient(Fallo(ReportSourceFailure.DatabaseError).Run! with { DuplicateKeys = ["05001"] }));
    }

    [Fact]
    public async Task EnPausaNoSeEjecutaNada()
    {
        using var escenario = await Escenario.CrearAsync(Lunes9, pausada: true);
        escenario.Reloj.Set(Lunes9.AddDays(2));

        Assert.Equal(0, await escenario.TickAsync());
        Assert.Empty(escenario.Llamadas);
    }

    [Fact]
    public async Task AlArrancarSeAnotaLoQueQuedoAMediasYSeRepite()
    {
        using var escenario = await Escenario.CrearAsync(Lunes9);
        var programada = await escenario.ProgramadaAsync();

        // Druse reclamó el horario y se cerró sin completarlo.
        Assert.True(await escenario.Programaciones.TryClaimAsync(
            programada, programada.NextRunUtc.AddDays(1), programada.NextRunUtc, CancellationToken.None));
        escenario.Reloj.Set(programada.NextRunUtc.AddHours(5));

        Assert.Equal(1, await escenario.Despachador.RecoverAsync(CancellationToken.None));
        var intento = Assert.Single(await escenario.Intentos.GetRecentAsync(escenario.DatasetId, 5, CancellationToken.None));
        Assert.Equal(ReportRunStatus.Interrupted, intento.Status);
        // El motivo vuelve de SQLite con su clave: la ventana lo escribe en su idioma.
        Assert.Equal(Druse.Domain.MessageKeys.Reports.Interrupted, intento.Localized?.Key);
        Assert.Equal(ReportRunOrigin.Scheduled, intento.Origin);

        Assert.Equal(1, await escenario.TickAsync());
        Assert.Single(escenario.Llamadas);
        Assert.Equal(0, await escenario.Despachador.RecoverAsync(CancellationToken.None));
    }

    [Fact]
    public async Task GuardarOlvidaElReintentoYBorrarElConjuntoBorraSuProgramacion()
    {
        using var escenario = await Escenario.CrearAsync(Lunes9);
        escenario.Reloj.Set(Lunes9.AddDays(1));
        escenario.Respuestas.Enqueue(Fallo(ReportSourceFailure.DatabaseError));
        await escenario.TickAsync();
        Assert.NotNull((await escenario.ProgramadaAsync()).RetryAtUtc);

        var programada = await escenario.ProgramadaAsync();
        var guardada = await escenario.Programaciones.SaveAsync(programada with { Paused = true }, CancellationToken.None);
        Assert.Null(guardada.RetryAtUtc);
        Assert.True(guardada.Paused);

        var conjuntos = new SqliteReportDatasetStore(escenario.Rutas, escenario.Reloj);
        await conjuntos.DeleteAsync(escenario.DatasetId, CancellationToken.None);
        Assert.Null(await escenario.Programaciones.FindAsync(escenario.DatasetId, CancellationToken.None));
    }

    private static ReportRefreshResult Fallo(string codigo) => new(ReportRefreshOutcome.Failed, new ReportRun
    {
        Id = Guid.NewGuid(),
        DatasetId = Guid.NewGuid(),
        DefinitionVersion = 1,
        Origin = ReportRunOrigin.Scheduled,
        Status = ReportRunStatus.Failed,
        StartedAtUtc = Lunes9,
        CompletedAtUtc = Lunes9,
        Sources = [new ReportRunSource("Ventas", codigo, "caída", 0, false, Lunes9, Lunes9)],
    });

    private sealed class Escenario : IDisposable
    {
        private Escenario(TemporaryPaths rutas, ManualClock reloj)
        {
            Rutas = rutas;
            Reloj = reloj;
            Programaciones = new SqliteReportScheduleStore(rutas, reloj);
            Intentos = new SqliteReportRunStore(rutas);
            Despachador = new ReportScheduleDispatcher(Programaciones, Intentos, reloj);
        }

        public TemporaryPaths Rutas { get; }

        public ManualClock Reloj { get; }

        public SqliteReportScheduleStore Programaciones { get; }

        public SqliteReportRunStore Intentos { get; }

        public ReportScheduleDispatcher Despachador { get; }

        public Guid DatasetId { get; } = Guid.NewGuid();

        public System.Collections.Concurrent.ConcurrentQueue<Guid> Llamadas { get; } = new();

        public Queue<ReportRefreshResult> Respuestas { get; } = new();

        public TimeSpan Demora { get; set; }

        public static async Task<Escenario> CrearAsync(DateTimeOffset ahora, bool pausada = false)
        {
            var rutas = new TemporaryPaths();
            rutas.EnsureCreated();
            var escenario = new Escenario(rutas, new ManualClock(ahora));
            await escenario.Programaciones.SaveAsync(new ReportSchedule
            {
                DatasetId = escenario.DatasetId,
                Rule = DiariaA7,
                Paused = pausada,
                NextRunUtc = ReportScheduleCalendar.NextAfter(DiariaA7, ahora),
            }, CancellationToken.None);
            return escenario;
        }

        public Task<int> TickAsync() => Despachador.TickAsync(Actualizar, CancellationToken.None);

        public async Task<ReportRefreshResult> Actualizar(Guid datasetId, CancellationToken cancellationToken)
        {
            Llamadas.Enqueue(datasetId);
            if (Demora > TimeSpan.Zero)
            {
                await Task.Delay(Demora, cancellationToken);
            }

            return Respuestas.TryDequeue(out var respuesta)
                ? respuesta
                : new ReportRefreshResult(ReportRefreshOutcome.Refreshed, null);
        }

        public async Task<ReportSchedule> ProgramadaAsync() =>
            await Programaciones.FindAsync(DatasetId, CancellationToken.None)
            ?? throw new InvalidOperationException("No hay programación.");

        public void Dispose() => Rutas.Dispose();
    }

    private sealed class ManualClock(DateTimeOffset now) : TimeProvider
    {
        private DateTimeOffset _now = now;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Set(DateTimeOffset now) => _now = now;

        public void Advance(TimeSpan delta) => _now += delta;
    }
}
