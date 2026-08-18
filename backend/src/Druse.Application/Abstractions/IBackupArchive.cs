using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Un respaldo ya escrito, abierto para leerlo.
///
/// Es la otra mitad de <see cref="IBackupSink"/>: aquel reparte el respaldo en un
/// archivo, una carpeta o un `.zip`, y este lo vuelve a juntar en el orden en que
/// hay que ejecutarlo. La restauración no sabe cuál de las tres formas tiene
/// delante, igual que el respaldo no sabe en cuál está escribiendo.
///
/// **Nada se carga entero en memoria.** Un artefacto puede ocupar gigabytes y se
/// abre para mirarlo antes de decidir si es el que se buscaba.
/// </summary>
public interface IBackupArchive : IDisposable
{
    /// <summary>Ruta del archivo o de la carpeta.</summary>
    string Path { get; }

    BackupLayout Layout { get; }

    bool Compressed { get; }

    /// <summary>El manifiesto, o `null` si el artefacto no lo trae.</summary>
    Task<BackupManifest?> ReadManifestAsync(CancellationToken cancellationToken);

    /// <summary>
    /// Las instrucciones, en el orden en que hay que ejecutarlas.
    ///
    /// El orden es el del §4.2 del plan y lo pone quien lee: los esquemas antes
    /// que sus tablas, los datos antes que los índices, y las claves foráneas al
    /// final porque entre dos tablas puede haber un ciclo.
    /// </summary>
    IAsyncEnumerable<string> ReadStatementsAsync(CancellationToken cancellationToken);
}

/// <summary>
/// Abre lo que haya en una ruta, mirando qué es.
///
/// Existe como puerto para que la restauración no dependa de cómo se guardan los
/// archivos, que es exactamente lo que cambia entre las tres formas de salida.
/// </summary>
public interface IBackupArchiveFactory
{
    /// <summary>
    /// Abre el artefacto de esa ruta.
    ///
    /// Decide por lo que hay en el disco y no por la extensión: un `.sql`
    /// renombrado sigue siendo un archivo suelto.
    /// </summary>
    IBackupArchive Open(string path);
}
