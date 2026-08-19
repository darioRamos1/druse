using System.Collections.Concurrent;
using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Infrastructure.Backups;

/// <summary>
/// Respaldos en marcha y lo último que se supo de cada uno.
///
/// Dos diccionarios y no uno, porque tienen vidas distintas: la fuente de
/// cancelación muere cuando el respaldo termina, y **el estado se queda**. Un
/// resumen que desapareciera al acabar no serviría para algo que tardó veinte
/// minutos y que quizá terminó sin nadie mirando.
///
/// El historial se recorta para que un proceso largo no acumule estados sin fin.
/// </summary>
public sealed class BackupTracker : IBackupTracker, IDisposable
{
    /// <summary>Cuántos respaldos terminados se recuerdan.</summary>
    private const int Remembered = 20;

    private readonly ConcurrentDictionary<Guid, CancellationTokenSource> _running = new();
    private readonly ConcurrentDictionary<Guid, BackupProgress> _progress = new();
    private readonly ConcurrentQueue<Guid> _finished = new();

    public CancellationToken Start(Guid backupId, CancellationToken linkedToken)
    {
        var source = CancellationTokenSource.CreateLinkedTokenSource(linkedToken);

        if (!_running.TryAdd(backupId, source))
        {
            source.Dispose();
            throw new InvalidOperationException($"El respaldo '{backupId}' ya está registrado.");
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
    public void Report(BackupProgress progress)
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
    private static BackupProgress Newer(BackupProgress previous, BackupProgress candidate)
    {
        var terminado = previous.Outcome != BackupOutcome.Running;

        if (terminado)
        {
            return candidate.Outcome == BackupOutcome.Running ? previous : candidate;
        }

        return candidate.Outcome == BackupOutcome.Running && candidate.Elapsed < previous.Elapsed
            ? previous
            : candidate;
    }

    public BackupProgress? Find(Guid backupId) =>
        _progress.TryGetValue(backupId, out var progress) ? progress : null;

    public bool Cancel(Guid backupId)
    {
        if (!_running.TryGetValue(backupId, out var source))
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

    public void Finish(Guid backupId)
    {
        if (_running.TryRemove(backupId, out var source))
        {
            source.Dispose();
        }

        _finished.Enqueue(backupId);

        while (_finished.Count > Remembered && _finished.TryDequeue(out var old))
        {
            _progress.TryRemove(old, out _);
        }
    }

    public void Dispose()
    {
        foreach (var backupId in _running.Keys.ToList())
        {
            Finish(backupId);
        }
    }
}
