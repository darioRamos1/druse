namespace Druse.Domain;

/// <summary>Qué columna del origen va a qué columna del destino.</summary>
/// <param name="Source">Nombre de la columna en el origen.</param>
/// <param name="Target">Columna del destino, o `null` para no copiarla.</param>
public sealed record ColumnMapping(string Source, string? Target);

/// <summary>
/// Qué hace el traslado con las filas que ya están en el destino.
///
/// Los números son parte del contrato con la interfaz: viajan en JSON y un perfil
/// guardado los relee meses después, así que no se renumeran.
/// </summary>
public enum TransferMode
{
    /// <summary>
    /// Añade las filas. Si una choca con una clave existente, falla.
    ///
    /// Es el modo por omisión porque es el único que no puede perder nada de lo
    /// que ya había: lo peor que hace es negarse.
    /// </summary>
    Insert = 0,

    /// <summary>
    /// Vacía la tabla destino y carga las filas del origen.
    ///
    /// **Borra datos**, así que quien lo pide tiene que escribir el nombre de la
    /// tabla: ver <see cref="DataTransferRequest.ReplaceConfirmation"/>.
    /// </summary>
    Replace = 1,

    /// <summary>Actualiza la fila si ya está y la inserta si no. Llega en la fase 2.</summary>
    Upsert = 2,

    /// <summary>Inserta solo lo que todavía no está, y cuenta lo saltado. Llega en la fase 2.</summary>
    SkipExisting = 3,
}

/// <summary>
/// Lo que se pide trasladar: de qué tabla a qué tabla, con qué columnas y cómo.
///
/// Las dos sesiones se nombran por separado y pueden ser la misma: copiar entre
/// dos esquemas de la misma conexión y copiar de dev a prod son el mismo trabajo
/// visto desde aquí, y distinguirlos obligaría a mantener dos caminos que harían
/// lo mismo.
/// </summary>
public sealed record DataTransferRequest
{
    public required Guid SourceSessionId { get; init; }

    public required DatabaseObject Source { get; init; }

    public required Guid TargetSessionId { get; init; }

    public required DatabaseObject Target { get; init; }

    /// <summary>Qué filas y qué columnas se llevan. Vacío significa la tabla entera.</summary>
    public TableDataFilter Filter { get; init; } = TableDataFilter.None;

    /// <summary>Si viene vacío, las columnas se emparejan por nombre.</summary>
    public IReadOnlyList<ColumnMapping> Mappings { get; init; } = [];

    public TransferMode Mode { get; init; } = TransferMode.Insert;

    /// <summary>
    /// Todos los lotes en una sola transacción: o entra la tabla entera o nada.
    ///
    /// **No es el valor por omisión**, y esa es la decisión importante de aquí. Una
    /// transacción que abarque millones de filas revienta el registro del servidor
    /// destino y mantiene la tabla bloqueada mientras dura; por lotes, lo copiado
    /// se queda y el resumen dice hasta dónde llegó. Para una tabla pequeña, donde
    /// dejarla a medias sería peor que no copiarla, se pide esto.
    /// </summary>
    public bool Atomic { get; init; }

    /// <summary>Filas por lote. Ver <see cref="ValidBatchSize"/>.</summary>
    public int BatchSize { get; init; } = DefaultBatchSize;

    /// <summary>
    /// Copiar también los valores de las columnas que genera el motor.
    ///
    /// Verdadero por omisión, y no es un detalle: si la fila 42 de dev llega a
    /// prod con otro identificador, todo lo que apuntaba a ella deja de apuntar a
    /// nada. Quien quiera identificadores nuevos —porque los del origen chocarían
    /// con los que ya hay— lo apaga a sabiendas.
    /// </summary>
    public bool KeepIdentity { get; init; } = true;

    /// <summary>El usuario ya vio la vista previa.</summary>
    public bool Confirmed { get; init; }

    /// <summary>
    /// El nombre de la tabla destino escrito a mano, solo para
    /// <see cref="TransferMode.Replace"/>.
    ///
    /// Vaciar una tabla no se deshace, y una casilla marcada sin querer no se
    /// distingue de una marcada a propósito. Escribir el nombre sí.
    /// </summary>
    public string? ReplaceConfirmation { get; init; }

    /// <summary>Filas por lote cuando nadie dice otra cosa.</summary>
    public const int DefaultBatchSize = 1_000;

    /// <summary>
    /// Tope por lote.
    ///
    /// No es una cifra redonda por gusto: cada fila del lote es un `INSERT` con
    /// sus parámetros, y lotes mucho mayores retienen memoria sin que el traslado
    /// vaya más rápido.
    /// </summary>
    public const int MaxBatchSize = 50_000;

    /// <summary>El tamaño de lote pedido, ajustado a lo que se admite.</summary>
    public int ValidBatchSize =>
        BatchSize <= 0 ? DefaultBatchSize : Math.Min(BatchSize, MaxBatchSize);
}

/// <summary>En qué anda un traslado.</summary>
public enum TransferStep
{
    /// <summary>Leyendo las columnas de los dos lados y emparejándolas.</summary>
    ReadingStructure = 0,

    /// <summary>Vaciando la tabla destino, solo en <see cref="TransferMode.Replace"/>.</summary>
    ClearingTarget = 1,

    CopyingRows = 2,

    Done = 3,
}

/// <summary>Cómo acabó.</summary>
public enum TransferOutcome
{
    Running = 0,
    Completed = 1,

    /// <summary>Terminó, pero hay algo que el usuario tiene que leer.</summary>
    CompletedWithWarnings = 2,

    Cancelled = 3,
    Failed = 4,
}

/// <summary>Algo que no impidió seguir pero que hay que contar.</summary>
public readonly record struct TransferWarning(string Subject, string Message);

/// <summary>
/// Por qué se paró un traslado.
///
/// Lleva **cuántas filas habían entrado ya**, y no solo el mensaje del motor,
/// porque con lotes esa es la única pregunta que importa cuando algo falla a
/// mitad: qué quedó escrito en el destino y desde dónde hay que reanudar.
/// </summary>
/// <param name="Message">Mensaje del motor, ya normalizado.</param>
/// <param name="RowsCommitted">Filas confirmadas en el destino antes del fallo.</param>
/// <param name="Statement">La instrucción que lo provocó, si se conoce.</param>
public readonly record struct TransferFailure(string Message, long RowsCommitted, string? Statement);

/// <summary>
/// Lo que se sabe de un traslado mientras corre.
///
/// Se sirve tal cual al cliente, que lo pide cada medio segundo. Es el equivalente
/// de <see cref="BackupProgress"/> y comparte su regla más importante: la
/// estimación puede faltar, y cuando falta la barra va indeterminada en lugar de
/// inventarse un porcentaje.
/// </summary>
public sealed record TransferProgress
{
    public required Guid Id { get; init; }

    public TransferStep Step { get; init; }

    public TransferOutcome Outcome { get; init; } = TransferOutcome.Running;

    /// <summary>Tabla que se está copiando, con su nombre calificado.</summary>
    public string? CurrentObject { get; init; }

    /// <summary>
    /// Filas que el destino ya confirmó.
    ///
    /// Sin «todo o nada», esto es lo que de verdad hay escrito allí: cada lote se
    /// confirma por su cuenta, así que el número no vuelve atrás aunque el
    /// traslado falle después.
    /// </summary>
    public long RowsCopied { get; init; }

    /// <summary>
    /// Filas que se esperan, **estimadas** por el catálogo del origen.
    ///
    /// Nula cuando no hay estimación fiable —una condición `WHERE`, una vista— y
    /// entonces se enseña el contador absoluto sin barra. Una barra que llega al
    /// 90 % y se queda ahí es peor que no tener barra.
    /// </summary>
    public long? RowsEstimated { get; init; }

    /// <summary>Filas que el destino rechazó y se saltaron, en los modos que lo permiten.</summary>
    public long RowsSkipped { get; init; }

    /// <summary>Lotes ya confirmados. Con «todo o nada» se queda en cero hasta el final.</summary>
    public int BatchesDone { get; init; }

    public TimeSpan Elapsed { get; init; }

    public IReadOnlyList<TransferWarning> Warnings { get; init; } = [];

    /// <summary>Presente cuando <see cref="Outcome"/> es <see cref="TransferOutcome.Failed"/>.</summary>
    public TransferFailure? Failure { get; init; }
}
