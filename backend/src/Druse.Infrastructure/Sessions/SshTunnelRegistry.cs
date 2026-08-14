using System.Collections.Concurrent;
using Druse.Application.Abstractions;

namespace Druse.Infrastructure.Sessions;

/// <summary>
/// Túneles abiertos, en memoria y seguros entre hilos.
///
/// Igual que las sesiones: un túnel es una conexión viva y no sobrevive al
/// reinicio del proceso, así que no hay nada que persistir.
/// </summary>
public sealed class SshTunnelRegistry : ISshTunnelRegistry
{
    private readonly ConcurrentDictionary<Guid, ISshTunnel> _tunnels = new();

    public void Add(Guid sessionId, ISshTunnel tunnel)
    {
        ArgumentNullException.ThrowIfNull(tunnel);

        _tunnels[sessionId] = tunnel;
    }

    public async Task<bool> CloseAsync(Guid sessionId)
    {
        if (!_tunnels.TryRemove(sessionId, out var tunnel))
        {
            return false;
        }

        await tunnel.DisposeAsync();

        return true;
    }

    /// <summary>
    /// Cierra todos al apagar.
    ///
    /// Los fallos individuales se ignoran a propósito: un túnel que ya se cayó no
    /// debe impedir cerrar los demás ni bloquear el apagado.
    /// </summary>
    public async Task CloseAllAsync()
    {
        foreach (var sessionId in _tunnels.Keys.ToList())
        {
            try
            {
                await CloseAsync(sessionId);
            }
            catch (Exception exception) when (exception is not OperationCanceledException)
            {
                // Nada que hacer durante el apagado.
            }
        }
    }
}
