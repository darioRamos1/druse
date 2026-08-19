using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Guarda el estado de los traslados de datos en marcha y de los que acaban de
/// terminar.
///
/// Existe por lo mismo que el de respaldos —la petición que lo lanzó termina
/// enseguida y la cancelación llega por otra, y la ventana se puede cerrar— y por
/// una razón que aquí pesa más: **un traslado escribe en otra base**. Si el
/// asistente se cierra a mitad, la única forma de saber cuántas filas llegaron al
/// destino es preguntárselo a esto.
///
/// El estado vive en memoria y se sirve tal cual: se consulta cada medio segundo y
/// no debe tocar ninguna de las dos conexiones.
/// </summary>
public interface ITransferTracker
{
    /// <summary>
    /// Anota un traslado que empieza y devuelve el token que hay que pasarle.
    ///
    /// El token se cancela cuando alguien llama a <see cref="Cancel"/>.
    /// </summary>
    CancellationToken Start(Guid transferId, CancellationToken linkedToken);

    /// <summary>Guarda lo último que se sabe. Lo llama el propio traslado mientras corre.</summary>
    void Report(TransferProgress progress);

    /// <summary>Lo último que se sabe de un traslado, o `null` si nadie lo conoce.</summary>
    TransferProgress? Find(Guid transferId);

    /// <summary>Pide que pare. Devuelve `false` si ya había terminado.</summary>
    bool Cancel(Guid transferId);

    /// <summary>
    /// Da por cerrado el traslado.
    ///
    /// El estado **se conserva** después de terminar: cuántas filas llegaron es
    /// justo lo que se va a preguntar cuando el traslado ya no está.
    /// </summary>
    void Finish(Guid transferId);
}
