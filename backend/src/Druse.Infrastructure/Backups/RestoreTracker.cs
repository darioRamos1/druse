using System.Collections.Concurrent;

using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Infrastructure.Backups;

/// <summary>
/// Restauraciones en marcha y lo último que se supo de cada una.
///
/// Es gemelo de <see cref="BackupTracker"/> y por los mismos motivos: dos
/// diccionarios porque la fuente de cancelación muere al terminar y **el estado
/// se queda**. Aquí el estado que se queda importa incluso más: cuando una
/// restauración se para a mitad, ese registro es lo único que dice hasta dónde
/// se aplicó, y sin él nadie sabría desde dónde reanudar.
/// </summary>
public sealed class RestoreTracker : IRestoreTracker, IDisposable
{
    /// <summary>Cuántas restauraciones terminadas se recuerdan.</summary>
    private const int Remembered = 20;

    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _running = new();
    private readonly ConcurrentDictionary<Guid, RestoreProgress> _progress = new();
    private readonly ConcurrentQueue<Guid> _finished = new();

    public CancellationToken Start(Guid restoreId, CancellationToken linkedToken)
    {
        var source = CancellationTokenSource.CreateLinkedTokenSource(linkedToken);

        if (!_running.TryAdd(restoreId, source))
        {
            source.Dispose();
            throw new InvalidOperationException($"La restauración '{restoreId}' ya está registrada.");
        }

        return source.Token;
    }

    /// <summary>
    /// Guarda lo último que se sabe, **sin dejar que un aviso viejo pise al final**.
    ///
    /// Los avisos de progreso viajan por `Progress&lt;T&gt;`, que los entrega en el
    /// grupo de hilos y **no garantiza el orden**: el «terminado» puede llegar
    /// antes que el último «en marcha» que lo precedía. Guardando a ciegas el que
    /// llegue, el estado se queda en marcha para siempre; quien mira la pantalla
    /// ve una barra que no acaba nunca y el resumen no aparece jamás, aunque el
    /// trabajo esté hecho.
    /// </summary>
    public void Report(RestoreProgress progress)
    {
        ArgumentNullException.ThrowIfNull(progress);

        _progress.AddOrUpdate(progress.Id, progress, (_, previous) => Newer(previous, progress));
    }

    /// <summary>
    /// Cuál de los dos estados vale: el nuevo, salvo que llegue tarde.
    ///
    /// Terminar es definitivo —lo que acabó no vuelve a estar en marcha— y entre
    /// dos avisos en marcha manda el que lleva más tiempo corrido, para que el
    /// recuento no vaya hacia atrás delante de quien lo está mirando.
    /// </summary>
    private static RestoreProgress Newer(RestoreProgress previous, RestoreProgress candidate)
    {
        var terminado = previous.Outcome != RestoreOutcome.Running;

        if (terminado)
        {
            return candidate.Outcome == RestoreOutcome.Running ? previous : candidate;
        }

        return candidate.Outcome == RestoreOutcome.Running && candidate.Elapsed < previous.Elapsed
            ? previous
            : candidate;
    }

    public RestoreProgress? Find(Guid restoreId) =>
        _progress.TryGetValue(restoreId, out var progress) ? progress : null;

    public bool Cancel(Guid restoreId)
    {
        if (!_running.TryGetValue(restoreId, out var source))
        {
            return false;
        }

        try
        {
            source.Cancel();

            return true;
        }
        catch (ObjectDisposedException)
        {
            // Terminó entre la búsqueda y la cancelación.
            return false;
        }
    }

    public void Finish(Guid restoreId)
    {
        if (_running.TryRemove(restoreId, out var source))
        {
            source.Dispose();
        }

        _finished.Enqueue(restoreId);

        while (_finished.Count > Remembered && _finished.TryDequeue(out var old))
        {
            _progress.TryRemove(old, out _);
        }
    }

    public void Dispose()
    {
        foreach (var restoreId in _running.Keys.ToList())
        {
            Finish(restoreId);
        }
    }
}
