using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Algo que hay que aplicar del artefacto, en el orden en que va.
///
/// No todo lo que trae un respaldo es una instrucción. Con los datos en CSV, las
/// filas viajan en un archivo aparte y hay que meterlas por el camino de la
/// importación, no ejecutando SQL. Quien restaura tiene que distinguirlo, y por
/// eso el artefacto entrega entradas y no cadenas.
/// </summary>
public abstract record BackupEntry;

/// <summary>Una instrucción SQL, lista para ejecutarse tal cual.</summary>
public sealed record BackupStatement(string Sql) : BackupEntry;

/// <summary>
/// Un puñado de filas de una tabla, leídas de un archivo de datos.
///
/// Van por lotes y no de una vez porque una tabla puede traer millones de filas:
/// el lote es lo que acota la memoria y, de paso, lo que permite reanudar una
/// restauración sin repetir lo que ya entró.
/// </summary>
public sealed record BackupRows : BackupEntry
{
    /// <summary>Nombre de la tabla tal y como lo nombró el respaldo.</summary>
    public required string Table { get; init; }

    /// <summary>De qué archivo salieron, para poder decirlo si algo falla.</summary>
    public required string Source { get; init; }

    /// <summary>Columnas del archivo, en su orden.</summary>
    public required IReadOnlyList<string> Columns { get; init; }

    /// <summary>Las filas del lote, sin interpretar: cada celda es texto o nulo.</summary>
    public required IReadOnlyList<IReadOnlyList<string?>> Rows { get; init; }

    /// <summary>
    /// Número de la primera fila del lote dentro del archivo, contando desde uno
    /// y sin la cabecera. Es lo que hace útil un error: «falló en la fila 12.480».
    /// </summary>
    public required long FirstRow { get; init; }
}

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
    /// Todo lo que hay que aplicar, en el orden en que hay que aplicarlo.
    ///
    /// El orden es el del §4.2 del plan y lo pone quien lee: los esquemas antes
    /// que sus tablas, los datos antes que los índices, y las claves foráneas al
    /// final porque entre dos tablas puede haber un ciclo. Los datos en CSV
    /// ocupan el mismo lugar que los `INSERT` a los que sustituyen.
    /// </summary>
    IAsyncEnumerable<BackupEntry> ReadEntriesAsync(CancellationToken cancellationToken);
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
