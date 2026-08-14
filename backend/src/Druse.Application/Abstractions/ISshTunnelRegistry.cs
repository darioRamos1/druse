namespace Druse.Application.Abstractions;

/// <summary>
/// Túneles abiertos, atados a la sesión que los usa.
///
/// Vive fuera del caso de uso porque un túnel dura lo que dura la sesión, y esa
/// sesión sobrevive a la petición HTTP que la abrió. Tampoco puede vivir dentro
/// de la sesión: la sesión es del proveedor, que comprueba su propio tipo para
/// abrir otras bases del mismo servidor y no admite que se la envuelva.
/// </summary>
public interface ISshTunnelRegistry
{
    /// <summary>Toma posesión del túnel: cerrarlo pasa a ser cosa del registro.</summary>
    void Add(Guid sessionId, ISshTunnel tunnel);

    /// <summary>Cierra el túnel de una sesión. `false` si no tenía ninguno.</summary>
    Task<bool> CloseAsync(Guid sessionId);

    /// <summary>Cierra todos. Se usa al apagar el proceso (plan §12).</summary>
    Task CloseAllAsync();
}
