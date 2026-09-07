using Druse.Application.Abstractions;
using Druse.Persistence.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// Lo que se recuerda de los trabajos largos de una sesión a la siguiente.
///
/// Todo esto existe por una pregunta que **solo se puede responder desde fuera
/// del proceso**: ¿quedó algo a medias la última vez? Los registros en memoria de
/// respaldos, restauraciones y traslados se van con Druse, y es entonces cuando
/// hace falta saberlo.
/// </summary>
public sealed class JobStoreTests : IDisposable
{
    private readonly TemporaryPaths _paths = new();
    private readonly DruseDatabase _database;
    private readonly SqliteJobStore _store;

    public JobStoreTests()
    {
        _database = new DruseDatabase(_paths);
        _database.MigrateAsync(CancellationToken.None).GetAwaiter().GetResult();
        _store = new SqliteJobStore(_database);
    }

    public void Dispose() => _paths.Dispose();

    private static JobRecord Job(JobKind kind = JobKind.Backup, string? subject = "C:/respaldos/hoy") => new()
    {
        Id = Guid.NewGuid(),
        Kind = kind,
        Subject = subject,
        State = JobState.Running,
        StartedAtUtc = DateTimeOffset.UtcNow,
    };

    [Fact]
    public async Task UnTrabajoQueEmpiezaQuedaEnMarcha()
    {
        var job = Job();

        await _store.StartedAsync(job, CancellationToken.None);

        var saved = Assert.Single(await _store.RecentAsync(20, CancellationToken.None));

        Assert.Equal(job.Id, saved.Id);
        Assert.Equal(JobKind.Backup, saved.Kind);
        Assert.Equal("C:/respaldos/hoy", saved.Subject);
        Assert.Equal(JobState.Running, saved.State);
        Assert.Null(saved.Outcome);
        Assert.Null(saved.FinishedAtUtc);
    }

    [Fact]
    public async Task AlTerminarSeGuardaComoAcabo()
    {
        var job = Job(JobKind.Transfer, subject: "clientes");

        await _store.StartedAsync(job, CancellationToken.None);
        await _store.FinishedAsync(job.Id, "CompletedWithWarnings", CancellationToken.None);

        var saved = Assert.Single(await _store.RecentAsync(20, CancellationToken.None));

        Assert.Equal(JobState.Finished, saved.State);
        Assert.Equal("CompletedWithWarnings", saved.Outcome);
        Assert.NotNull(saved.FinishedAtUtc);
    }

    /// <summary>
    /// El caso para el que existe todo esto: Druse se cerró con un respaldo
    /// corriendo y nadie llegó a escribir cómo acabó.
    ///
    /// Al arrancar, ese «en marcha» no puede seguir diciendo que lo está: no hay
    /// ningún proceso detrás. Y no es un fallo ni una cancelación —nadie lo
    /// supo—, así que tiene su propio estado.
    /// </summary>
    [Fact]
    public async Task LoQueSeguiaEnMarchaAlArrancarQuedaComoInterrumpido()
    {
        var interrumpido = Job();
        var terminado = Job(JobKind.Restore, subject: "C:/respaldos/ayer.sql");

        await _store.StartedAsync(interrumpido, CancellationToken.None);
        await _store.StartedAsync(terminado, CancellationToken.None);
        await _store.FinishedAsync(terminado.Id, "Completed", CancellationToken.None);

        var marcados = await _store.InterruptRunningAsync(CancellationToken.None);

        Assert.Equal(1, marcados);

        var jobs = await _store.RecentAsync(20, CancellationToken.None);

        Assert.Equal(JobState.Interrupted, jobs.Single(job => job.Id == interrumpido.Id).State);

        // Y el que sí terminó se queda como estaba: repetir el arranque no puede
        // reescribir la historia de lo que ya se sabía.
        Assert.Equal(JobState.Finished, jobs.Single(job => job.Id == terminado.Id).State);
    }

    /// <summary>
    /// Arrancar dos veces seguidas no vuelve a marcar nada: ya no queda ninguno
    /// «en marcha».
    /// </summary>
    [Fact]
    public async Task ArrancarSinNadaAMediasNoMarcaNada()
    {
        await _store.StartedAsync(Job(), CancellationToken.None);
        await _store.InterruptRunningAsync(CancellationToken.None);

        Assert.Equal(0, await _store.InterruptRunningAsync(CancellationToken.None));
    }

    [Fact]
    public async Task LosUltimosSalenPrimero()
    {
        var viejo = Job() with { StartedAtUtc = DateTimeOffset.UtcNow.AddHours(-2) };
        var nuevo = Job() with { StartedAtUtc = DateTimeOffset.UtcNow };

        await _store.StartedAsync(viejo, CancellationToken.None);
        await _store.StartedAsync(nuevo, CancellationToken.None);

        var jobs = await _store.RecentAsync(20, CancellationToken.None);

        Assert.Equal([nuevo.Id, viejo.Id], jobs.Select(job => job.Id));
    }
}
