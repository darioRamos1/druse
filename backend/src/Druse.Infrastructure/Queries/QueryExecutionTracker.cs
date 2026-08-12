using System.Collections.Concurrent;
using Druse.Application.Abstractions;

namespace Druse.Infrastructure.Queries;

/// <summary>
/// Ejecuciones en curso y sus fuentes de cancelación.
///
/// Cada ejecución guarda un <see cref="CancellationTokenSource"/> enlazado al
/// token de la petición que la inició. Así se cancela por dos vías: porque el
/// usuario pulsa «Cancelar» —que llega en otra petición HTTP— o porque la
/// petición original se cae.
/// </summary>
public sealed class QueryExecutionTracker : IQueryExecutionTracker, IDisposable
{
    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _executions = new();

    public IReadOnlyCollection<Guid> Active => _executions.Keys.ToList();

    public CancellationToken Register(Guid executionId, CancellationToken linkedToken)
    {
        var source = CancellationTokenSource.CreateLinkedTokenSource(linkedToken);

        if (!_executions.TryAdd(executionId, source))
        {
            source.Dispose();
            throw new InvalidOperationException($"La ejecución '{executionId}' ya está registrada.");
        }

        return source.Token;
    }

    public bool Cancel(Guid executionId)
    {
        if (!_executions.TryGetValue(executionId, out var source))
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
            // La ejecución terminó entre la búsqueda y la cancelación.
            return false;
        }
    }

    public void Complete(Guid executionId)
    {
        if (_executions.TryRemove(executionId, out var source))
        {
            source.Dispose();
        }
    }

    public void Dispose()
    {
        foreach (var executionId in _executions.Keys.ToList())
        {
            Complete(executionId);
        }
    }
}
