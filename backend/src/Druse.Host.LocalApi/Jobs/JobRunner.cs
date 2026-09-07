using System.Collections.Concurrent;
using System.Threading.Channels;

using Druse.Application.Abstractions;

namespace Druse.Host.LocalApi.Jobs;

/// <summary>
/// La cola de trabajos largos y quien los ejecuta.
///
/// Es la misma clase porque son la misma cosa: un canal en memoria y el servicio
/// alojado que lo vacía. Separarlos obligaría a compartir el canal por un tercer
/// tipo que no aportaría nada.
///
/// **Cada trabajo corre en su propio scope de servicios.** Antes cada endpoint
/// lanzaba un `Task.Run` que se llevaba los servicios de la petición HTTP —el
/// servicio de respaldo, el de conexiones, los almacenes de SQLite— y seguía
/// usándolos después de que esa petición terminara y su scope se cerrara. Que no
/// se notara no lo hacía correcto: es un objeto desechado sirviendo trabajo de
/// horas.
///
/// **No se serializan.** Cada uno arranca en cuanto llega, como antes: hacerlos
/// esperar en fila cambiaría lo que ve el usuario —un traslado detrás de un
/// respaldo de tres horas— sin que nadie lo haya pedido. Lo que cambia es que
/// ahora alguien los conoce y espera a que terminen al apagar.
/// </summary>
public sealed class JobRunner(
    IServiceScopeFactory scopes,
    ILogger<JobRunner> logger) : BackgroundService, IBackgroundJobs
{
    /// <summary>Cuánto se espera a los trabajos en marcha al apagar la API.</summary>
    private static readonly TimeSpan ShutdownGrace = TimeSpan.FromSeconds(10);

    private readonly Channel<QueuedJob> _queue = Channel.CreateUnbounded<QueuedJob>(
        new UnboundedChannelOptions { SingleReader = true });

    private readonly ConcurrentDictionary<Guid, Task> _running = new();

    private readonly IServiceScopeFactory _scopes = scopes;
    private readonly ILogger<JobRunner> _logger = logger;

    /// <summary>Cuántos trabajos hay corriendo ahora mismo.</summary>
    public int RunningCount => _running.Count;

    public void Enqueue(QueuedJob job)
    {
        ArgumentNullException.ThrowIfNull(job);

        // Un canal sin límite solo rechaza si está cerrado, y eso solo pasa
        // mientras la API se apaga: entonces el trabajo no llega a empezar y
        // quien lo pidió se entera por el estado, no por una excepción aquí.
        if (!_queue.Writer.TryWrite(job) && _logger.IsEnabled(LogLevel.Warning))
        {
            _logger.LogWarning(
                "El trabajo {JobId} no se pudo encolar: la API se está apagando.",
                job.Id);
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await foreach (var job in _queue.Reader.ReadAllAsync(stoppingToken))
            {
                var task = RunAsync(job, stoppingToken);

                // Se guarda para poder esperarlo al apagar. Se quita solo cuando
                // termina, y el `TryRemove` va dentro de la propia tarea porque
                // aquí no se espera a nadie: el bucle tiene que seguir leyendo.
                _running[job.Id] = task;
            }
        }
        catch (OperationCanceledException)
        {
            // La API se apaga. Lo que quede en la cola no llega a empezar.
        }
    }

    /// <summary>
    /// Al apagar, se da un plazo a lo que esté corriendo.
    ///
    /// El token de parada llega a cada trabajo, así que lo que hacen es
    /// cancelarse y anotar en su registro que se cancelaron. Ese plazo es para
    /// que les dé tiempo a hacerlo: sin él, el proceso se iría dejando estados
    /// «en marcha» que ya no lo están.
    /// </summary>
    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        _queue.Writer.TryComplete();

        await base.StopAsync(cancellationToken);

        var pending = _running.Values.ToArray();

        if (pending.Length == 0)
        {
            return;
        }

        if (_logger.IsEnabled(LogLevel.Information))
        {
            _logger.LogInformation(
                "Esperando a {Count} trabajo(s) largo(s) antes de apagar.",
                pending.Length);
        }

        await Task.WhenAny(Task.WhenAll(pending), Task.Delay(ShutdownGrace, cancellationToken));
    }

    private async Task RunAsync(QueuedJob job, CancellationToken stoppingToken)
    {
        // Fuera del hilo del bucle: sin esto, el primer trabajo que tardara en
        // llegar a su primer `await` bloquearía la lectura de la cola.
        await Task.Yield();

        // El trabajo se cancela por dos vías: porque alguien lo pidió —su token—
        // o porque la API se apaga.
        using var linked = CancellationTokenSource.CreateLinkedTokenSource(job.Token, stoppingToken);

        await using var scope = _scopes.CreateAsyncScope();

        var store = scope.ServiceProvider.GetRequiredService<IJobStore>();

        // Se anota antes de empezar y no al terminar, que es lo que le da
        // sentido: si Druse se cierra a mitad, lo que queda escrito es un trabajo
        // «en marcha», y el arranque siguiente sabe que aquello se interrumpió.
        await WriteAsync(
            () => store.StartedAsync(
                new JobRecord
                {
                    Id = job.Id,
                    Kind = job.Kind,
                    Subject = job.Subject,
                    State = JobState.Running,
                    StartedAtUtc = DateTimeOffset.UtcNow,
                },
                CancellationToken.None),
            job.Id);

        var outcome = "Failed";

        try
        {
            outcome = await job.RunAsync(scope.ServiceProvider, linked.Token);
        }
        catch (Exception error)
        {
            // Quien encola ya atrapa lo suyo y lo anota en su registro; lo que
            // llegue aquí es lo que ni eso pudo. Sin este registro, el trabajo
            // desaparecería sin dejar rastro en ningún log.
            _logger.LogError(error, "El trabajo {JobId} terminó con un error no previsto.", job.Id);
        }
        finally
        {
            // Con `CancellationToken.None`: esto corre justo cuando la API se
            // está apagando, y con el token de parada no se escribiría nunca la
            // única línea que dice cómo acabó.
            await WriteAsync(() => store.FinishedAsync(job.Id, outcome, CancellationToken.None), job.Id);

            _running.TryRemove(job.Id, out _);
        }
    }

    /// <summary>
    /// Escribe en el registro sin dejar que un fallo suyo tumbe el trabajo.
    ///
    /// Anotar qué se hizo es útil, pero no al precio de tirar un respaldo de tres
    /// horas porque el archivo local estaba bloqueado un instante.
    /// </summary>
    private async Task WriteAsync(Func<Task> write, Guid jobId)
    {
        try
        {
            await write();
        }
        catch (Exception error)
        {
            _logger.LogWarning(error, "No se pudo anotar el trabajo {JobId}.", jobId);
        }
    }
}
