namespace Druse.Application.Abstractions;

/// <summary>
/// Sigue la pista de las ejecuciones en curso para poder cancelarlas.
///
/// Cancelar es un requisito del MVP, y sin un registro como este el botón
/// «Cancelar» no tendría a qué agarrarse: la petición HTTP que inició la consulta
/// sigue abierta esperando el resultado, y la cancelación llega por otra distinta.
/// </summary>
public interface IQueryExecutionTracker
{
    /// <summary>
    /// Registra una ejecución y devuelve el token que debe pasarse al proveedor.
    /// El token se cancela cuando alguien llama a <see cref="Cancel"/>.
    /// </summary>
    CancellationToken Register(Guid executionId, CancellationToken linkedToken);

    /// <summary>Solicita la cancelación. Devuelve `false` si la ejecución ya terminó.</summary>
    bool Cancel(Guid executionId);

    /// <summary>Quita la ejecución del registro. Debe llamarse siempre al terminar.</summary>
    void Complete(Guid executionId);

    /// <summary>Ejecuciones activas en este momento.</summary>
    IReadOnlyCollection<Guid> Active { get; }
}
