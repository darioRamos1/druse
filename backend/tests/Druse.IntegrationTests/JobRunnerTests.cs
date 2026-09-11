using Druse.Application.Abstractions;
using Druse.Host.LocalApi.Jobs;

using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace Druse.IntegrationTests;

/// <summary>
/// El orden en que se cuenta que un trabajo largo terminó.
///
/// Un respaldo deja rastro en dos sitios: el estado en memoria que consulta la
/// pantalla de progreso, y el registro de trabajos en SQLite, que es lo que
/// sobrevive a cerrar Druse. Son dos escrituras, así que entre ellas hay un
/// hueco, y **de qué lado cae ese hueco se ve desde la interfaz**: publicando el
/// final antes de anotarlo, quien mire los trabajos en ese instante encuentra un
/// respaldo terminado que dice que sigue en marcha, y que no se va a mover nunca
/// más.
///
/// Salió dos veces en la sesión 053, en una prueba que después pasó seis
/// seguidas. Esta no depende de ganar la carrera: comprueba el orden.
/// </summary>
public sealed class JobRunnerTests
{
    [Fact]
    public async Task ElFinalSeAnunciaDespuesDeQuedarAnotado()
    {
        var pasos = new List<string>();

        await using var services = new ServiceCollection()
            .AddSingleton<IJobStore>(new Registro(pasos))
            .BuildServiceProvider();

        var runner = new JobRunner(
            services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<JobRunner>.Instance);

        // El anuncio es lo último que pasa, así que esperar por él es esperar por
        // el trabajo entero sin dormir un tiempo fijo.
        var anunciado = new TaskCompletionSource();

        await runner.StartAsync(CancellationToken.None);

        try
        {
            runner.Enqueue(new QueuedJob
            {
                Id = Guid.NewGuid(),
                Kind = JobKind.Backup,
                Subject = "respaldo.sql",
                Token = CancellationToken.None,
                RunAsync = (_, _) =>
                {
                    pasos.Add("trabajo");

                    return Task.FromResult("Succeeded");
                },
                Announce = () =>
                {
                    pasos.Add("anuncio");
                    anunciado.SetResult();
                },
            });

            await anunciado.Task.WaitAsync(TimeSpan.FromSeconds(30));
        }
        finally
        {
            await runner.StopAsync(CancellationToken.None);
        }

        Assert.Equal(["empieza", "trabajo", "termina", "anuncio"], pasos);
    }

    /// <summary>
    /// Un anuncio que falla no se lleva por delante el trabajo ni el registro.
    ///
    /// Contar el final es información; el trabajo ya está hecho y anotado. Que una
    /// excepción de ahí tumbara el proceso sería perder lo importante por lo
    /// accesorio.
    /// </summary>
    [Fact]
    public async Task UnAnuncioQueFallaNoTumbaElTrabajo()
    {
        var pasos = new List<string>();

        await using var services = new ServiceCollection()
            .AddSingleton<IJobStore>(new Registro(pasos))
            .BuildServiceProvider();

        var runner = new JobRunner(
            services.GetRequiredService<IServiceScopeFactory>(),
            NullLogger<JobRunner>.Instance);

        var intentado = new TaskCompletionSource();

        await runner.StartAsync(CancellationToken.None);

        try
        {
            runner.Enqueue(new QueuedJob
            {
                Id = Guid.NewGuid(),
                Kind = JobKind.Transfer,
                Subject = "pedidos",
                Token = CancellationToken.None,
                RunAsync = (_, _) => Task.FromResult("Succeeded"),
                Announce = () =>
                {
                    intentado.SetResult();

                    throw new InvalidOperationException("nadie escuchaba");
                },
            });

            await intentado.Task.WaitAsync(TimeSpan.FromSeconds(30));

            // Lo que importa: el registro tiene su línea de final, y el proceso
            // sigue en pie para el siguiente trabajo.
            Assert.Equal(["empieza", "termina"], pasos);
        }
        finally
        {
            await runner.StopAsync(CancellationToken.None);
        }
    }

    /// <summary>Un registro que solo apunta el orden en que lo llaman.</summary>
    private sealed class Registro(List<string> pasos) : IJobStore
    {
        public Task StartedAsync(JobRecord record, CancellationToken cancellationToken)
        {
            pasos.Add("empieza");

            return Task.CompletedTask;
        }

        public Task FinishedAsync(Guid id, string outcome, CancellationToken cancellationToken)
        {
            pasos.Add("termina");

            return Task.CompletedTask;
        }

        public Task<int> InterruptRunningAsync(CancellationToken cancellationToken) =>
            Task.FromResult(0);

        public Task<IReadOnlyList<JobRecord>> RecentAsync(
            int limit,
            CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<JobRecord>>([]);
    }
}
