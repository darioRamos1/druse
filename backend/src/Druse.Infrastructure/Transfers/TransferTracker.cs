using System.Collections.Concurrent;
using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Infrastructure.Transfers;

/// <summary>
/// Traslados en marcha y lo último que se supo de cada uno.
///
/// Dos diccionarios y no uno, por lo mismo que en los respaldos: la fuente de
/// cancelación muere cuando el traslado termina, y **el estado se queda**. Aquí
/// eso importa todavía más, porque lo que sobrevive es el recuento de filas que
/// llegaron a la otra base.
///
/// El historial se recorta para que un proceso largo no acumule estados sin fin.
/// </summary>
public sealed class TransferTracker : ITransferTracker, IDisposable
{
    /// <summary>Cuántos traslados terminados se recuerdan.</summary>
    private const int Remembered = 20;

    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _running = new();
    private readonly ConcurrentDictionary<Guid, TransferProgress> _progress = new();
    private readonly ConcurrentQueue<Guid> _finished = new();

    public CancellationToken Start(Guid transferId, CancellationToken linkedToken)
    {
        var source = CancellationTokenSource.CreateLinkedTokenSource(linkedToken);

        if (!_running.TryAdd(transferId, source))
        {
            source.Dispose();
            throw new InvalidOperationException($"El traslado '{transferId}' ya está registrado.");
        }

        return source.Token;
    }

    public void Report(TransferProgress progress)
    {
        ArgumentNullException.ThrowIfNull(progress);

        _progress[progress.Id] = progress;
    }

    public TransferProgress? Find(Guid transferId) =>
        _progress.TryGetValue(transferId, out var progress) ? progress : null;

    public bool Cancel(Guid transferId)
    {
        if (!_running.TryGetValue(transferId, out var source))
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

    public void Finish(Guid transferId)
    {
        if (_running.TryRemove(transferId, out var source))
        {
            source.Dispose();
        }

        _finished.Enqueue(transferId);

        while (_finished.Count > Remembered && _finished.TryDequeue(out var old))
        {
            _progress.TryRemove(old, out _);
        }
    }

    public void Dispose()
    {
        foreach (var transferId in _running.Keys.ToList())
        {
            Finish(transferId);
        }
    }
}
