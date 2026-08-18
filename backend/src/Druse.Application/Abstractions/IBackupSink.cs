using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>Qué parte del respaldo es una entrada, para saber dónde colocarla.</summary>
public enum BackupEntryKind
{
    /// <summary>El `CREATE TABLE`.</summary>
    Structure = 0,

    /// <summary>Las filas: `INSERT` o CSV.</summary>
    Data = 1,

    /// <summary>Índices, claves y restricciones, que van después de los datos.</summary>
    Constraints = 2,

    /// <summary>
    /// El `CREATE SCHEMA` de los esquemas que el respaldo va a necesitar.
    ///
    /// Va primero que todo: sin él, aplicar el artefacto en una base recién
    /// creada falla en la primera instrucción, que es justo el caso que la
    /// función existe para resolver —llevarse la estructura a desarrollo—.
    /// </summary>
    Schema = 3,
}

/// <summary>Dónde quedó el respaldo y cuánto ocupa.</summary>
/// <param name="Path">Ruta del archivo o de la carpeta.</param>
/// <param name="Bytes">Tamaño en disco, para poder decirlo al terminar.</param>
public readonly record struct BackupArtifact(string Path, long Bytes);

/// <summary>
/// Dónde se escribe un respaldo.
///
/// Existe para que el servicio de respaldo no sepa si está llenando un `.sql`, un
/// árbol de carpetas o un `.zip`: eso lo decide quien lo construye. Y para que las
/// pruebas puedan comprobarlo sin montar media aplicación detrás.
///
/// **Quien lo implemente escribe según recibe.** Un respaldo de varios gigabytes
/// no puede acumularse para volcarlo al final.
/// </summary>
public interface IBackupSink : IAsyncDisposable
{
    /// <summary>Un fragmento de guion de un objeto.</summary>
    Task WriteAsync(
        BackupEntryKind kind,
        string objectName,
        string text,
        CancellationToken cancellationToken);

    /// <summary>
    /// Los datos de una tabla escritos por quien sepa hacerlo, sobre el flujo que
    /// le corresponda.
    ///
    /// Es lo que permite que el CSV lo escriba el mismo exportador que ya existe,
    /// sin que este puerto sepa nada de comas ni de codificaciones.
    /// </summary>
    Task WriteDataStreamAsync(
        string objectName,
        string extension,
        Func<Stream, CancellationToken, Task> write,
        CancellationToken cancellationToken);

    /// <summary>Cierra el artefacto y le pone su manifiesto.</summary>
    Task<BackupArtifact> CompleteAsync(BackupManifest manifest, CancellationToken cancellationToken);

    /// <summary>
    /// Tira lo escrito hasta ahora.
    ///
    /// Se llama al cancelar y al fallar: **un respaldo a medias con aspecto de
    /// completo es más peligroso que no tener ninguno**. En una salida por
    /// carpetas, lo ya escrito se conserva pero el manifiesto queda marcado como
    /// incompleto, porque ahí sí se ve qué hay y qué falta.
    /// </summary>
    Task DiscardAsync(CancellationToken cancellationToken);
}
