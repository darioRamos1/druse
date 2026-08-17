using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Guarda el estado de los respaldos en marcha y de los que acaban de terminar.
///
/// Existe por la misma razón que el registro de ejecuciones —la petición que
/// lanzó el respaldo sigue abierta y la cancelación llega por otra— y por una más:
/// **la ventana se puede cerrar**. El respaldo sigue en el proceso local, y quien
/// vuelva a abrir el asistente tiene que encontrar su progreso donde lo dejó.
///
/// El estado vive en memoria y se sirve tal cual: se consulta cada medio segundo y
/// no debe tocar ni la base ni el archivo que se está escribiendo.
/// </summary>
public interface IBackupTracker
{
    /// <summary>
    /// Anota un respaldo que empieza y devuelve el token que hay que pasarle.
    ///
    /// El token se cancela cuando alguien llama a <see cref="Cancel"/>.
    /// </summary>
    CancellationToken Start(Guid backupId, CancellationToken linkedToken);

    /// <summary>Guarda lo último que se sabe. Lo llama el propio respaldo mientras corre.</summary>
    void Report(BackupProgress progress);

    /// <summary>Lo último que se sabe de un respaldo, o `null` si nadie lo conoce.</summary>
    BackupProgress? Find(Guid backupId);

    /// <summary>Pide que pare. Devuelve `false` si ya había terminado.</summary>
    bool Cancel(Guid backupId);

    /// <summary>
    /// Da por cerrado el respaldo.
    ///
    /// El estado **se conserva** después de terminar: el resumen final no se
    /// desvanece solo, porque la operación pudo acabar sin nadie mirando.
    /// </summary>
    void Finish(Guid backupId);
}
