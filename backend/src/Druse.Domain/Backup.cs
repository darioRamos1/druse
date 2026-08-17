namespace Druse.Domain;

/// <summary>Cómo se reparte el respaldo en archivos.</summary>
public enum BackupLayout
{
    /// <summary>Todo en un `.sql`, en orden, listo para ejecutar de principio a fin.</summary>
    SingleFile = 0,

    /// <summary>
    /// Un árbol de carpetas con un archivo por objeto.
    ///
    /// Es lo que permite ver en un diff qué cambió de una semana a otra, que con
    /// un archivo de cien mil líneas no se puede.
    /// </summary>
    FolderByKind = 1,
}

/// <summary>Cómo se escriben las filas.</summary>
public enum BackupDataFormat
{
    /// <summary>`INSERT` que se pueden ejecutar tal cual.</summary>
    Inserts = 0,

    /// <summary>
    /// Un CSV por tabla, mucho más rápido y pequeño para tablas grandes.
    ///
    /// La estructura sigue yendo en `.sql`: lo que cambia es dónde van las filas.
    /// </summary>
    Csv = 1,
}

/// <summary>Qué forma tiene el archivo que se entrega.</summary>
public sealed record BackupOutput
{
    public BackupLayout Layout { get; init; } = BackupLayout.SingleFile;

    public BackupDataFormat Data { get; init; } = BackupDataFormat.Inserts;

    /// <summary>Empaqueta el resultado en un `.zip` con su manifiesto dentro.</summary>
    public bool Compress { get; init; }

    /// <summary>
    /// Los datos en CSV exigen carpetas: un `.sql` suelto no puede llevar dentro
    /// un archivo por tabla.
    /// </summary>
    public bool IsValid => Data != BackupDataFormat.Csv || Layout == BackupLayout.FolderByKind;
}

/// <summary>Qué parte del respaldo se está escribiendo.</summary>
public enum BackupStep
{
    Resolving = 0,
    ReadingStructure = 1,
    WritingStructure = 2,
    WritingData = 3,
    WritingConstraints = 4,
    Packaging = 5,
    Done = 6,
}

/// <summary>Cómo acabó una operación de respaldo.</summary>
public enum BackupOutcome
{
    /// <summary>Sigue trabajando.</summary>
    Running = 0,

    Completed = 1,

    /// <summary>
    /// Terminó, pero no se llevó todo lo que parecía.
    ///
    /// **No es un verde limpio**: el usuario tiene que saber que lo que tiene no
    /// es la copia completa que pidió.
    /// </summary>
    CompletedWithWarnings = 2,

    Failed = 3,

    Cancelled = 4,
}

/// <summary>
/// Algo que el usuario tiene que saber de su respaldo.
///
/// Va al manifiesto además de a la pantalla: quien encuentre el archivo medio año
/// después no vio esa pantalla.
/// </summary>
/// <param name="Subject">Objeto al que se refiere, o vacío si es del respaldo entero.</param>
/// <param name="Message">Qué pasó, escrito para leerlo tal cual.</param>
public readonly record struct BackupWarning(string Subject, string Message);

/// <summary>
/// Lo que se sabe de un respaldo en marcha.
///
/// Se sirve tal cual al cliente, que lo pide cada medio segundo. Todo lo que
/// necesita una barra de progreso honesta está aquí, incluido lo que hace falta
/// para **no** dibujarla cuando no se sabe el total.
/// </summary>
public sealed record BackupProgress
{
    public required Guid Id { get; init; }

    public BackupStep Step { get; init; }

    public BackupOutcome Outcome { get; init; } = BackupOutcome.Running;

    /// <summary>Objeto que se está escribiendo, con su nombre propio.</summary>
    public string? CurrentObject { get; init; }

    public int ObjectsDone { get; init; }

    public int ObjectsTotal { get; init; }

    /// <summary>Filas escritas de la tabla en curso.</summary>
    public long RowsDone { get; init; }

    /// <summary>
    /// Filas que se esperan de la tabla en curso, **estimadas** por el catálogo.
    ///
    /// Es nulo cuando no hay estimación fiable —una tabla con condición, una vista—
    /// y entonces la barra va indeterminada con el contador absoluto. Una barra que
    /// llega al 90 % y se queda ahí es peor que no tener barra.
    /// </summary>
    public long? RowsEstimated { get; init; }

    public long TotalRows { get; init; }

    public TimeSpan Elapsed { get; init; }

    public IReadOnlyList<BackupWarning> Warnings { get; init; } = [];

    /// <summary>Presente cuando <see cref="Outcome"/> es <see cref="BackupOutcome.Failed"/>.</summary>
    public BackupFailure? Failure { get; init; }

    /// <summary>Dónde quedó el archivo, cuando terminó bien.</summary>
    public string? Path { get; init; }

    public long? Bytes { get; init; }
}

/// <summary>
/// Por qué se paró un respaldo.
///
/// Lleva la instrucción exacta además del mensaje del motor: un error que solo
/// dice «A syntax error has occurred» no se diagnostica sin ella.
/// </summary>
/// <param name="Subject">Objeto que se estaba escribiendo.</param>
/// <param name="Message">Mensaje del motor, ya normalizado.</param>
/// <param name="Statement">La instrucción que lo provocó, si la hubo.</param>
public readonly record struct BackupFailure(string Subject, string Message, string? Statement);

/// <summary>
/// Lo que describe un respaldo desde dentro.
///
/// Todo artefacto lo lleva, aunque sea un `.sql` suelto —ahí va como cabecera de
/// comentarios—. Sin él, un archivo encontrado seis meses después no dice de dónde
/// salió ni si está completo.
/// </summary>
public sealed record BackupManifest
{
    /// <summary>
    /// Versión del **formato del artefacto**, no la de Druse.
    ///
    /// Existe para que un Druse futuro sepa leer los respaldos viejos o se niegue
    /// con un mensaje claro, en lugar de fallar a mitad de una restauración.
    /// </summary>
    public int FormatVersion { get; init; } = 1;

    public required string DruseVersion { get; init; }

    public required DateTimeOffset CreatedAt { get; init; }

    public required DatabaseEngine Engine { get; init; }

    /// <summary>Versión del servidor de origen, tal y como la anuncia.</summary>
    public required string ServerVersion { get; init; }

    public string? Server { get; init; }

    public string? Database { get; init; }

    public BackupLayout Layout { get; init; }

    public BackupDataFormat DataFormat { get; init; }

    public int Tables { get; init; }

    /// <summary>Cuántas de esas tablas se llevaron sus filas.</summary>
    public int TablesWithData { get; init; }

    public long Rows { get; init; }

    public BackupOutcome Outcome { get; init; }

    /// <summary>
    /// Si las lecturas se hicieron todas en el mismo instante.
    ///
    /// Va escrito porque un respaldo sin instantánea puede nacer roto —la tabla de
    /// pedidos leída a las 10:00 y la de líneas a las 10:04— y eso no se ve
    /// mirando el archivo.
    /// </summary>
    public bool ConsistentSnapshot { get; init; }

    public IReadOnlyList<BackupWarning> Warnings { get; init; } = [];
}
