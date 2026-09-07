namespace Druse.Domain;

/// <summary>En qué anda una restauración.</summary>
public enum RestoreStep
{
    /// <summary>Abriendo el artefacto y leyendo su manifiesto.</summary>
    Reading = 0,

    /// <summary>Comprobando que se puede aplicar sobre esta conexión.</summary>
    Checking = 1,

    Applying = 2,

    Done = 3,
}

/// <summary>Cómo acabó.</summary>
public enum RestoreOutcome
{
    Running = 0,

    Completed = 1,

    /// <summary>
    /// Se paró en una instrucción concreta.
    ///
    /// Aquí no hay «completado con avisos» como en el respaldo: al restaurar se
    /// está **modificando** una base, y seguir tras un error deja un destino a
    /// medias que nadie sabe describir (plan §7.6).
    /// </summary>
    Failed = 2,

    Cancelled = 3,
}

/// <summary>Por qué un artefacto no se puede aplicar sobre esta conexión.</summary>
public enum RestoreRefusal
{
    /// <summary>El artefacto viene de otro motor.</summary>
    DifferentEngine = 0,

    /// <summary>Lo escribió una versión de Druse que guarda de otra forma.</summary>
    UnknownFormat = 1,

    /// <summary>La conexión está marcada como solo lectura.</summary>
    ReadOnlyConnection = 2,

    /// <summary>No se encontró el archivo o la carpeta, o no se puede leer.</summary>
    Unreadable = 3,
}

/// <summary>Un motivo por el que no se sigue, ya escrito para leerlo.</summary>
/// <param name="Reason">Cuál de los casos previstos.</param>
/// <param name="Message">Qué se le dice al usuario.</param>
public readonly record struct RestoreRejection(RestoreRefusal Reason, string Message);

/// <summary>
/// Una tabla del artefacto que ya existe en el destino.
///
/// **Es lo que hay que enseñar antes de tocar nada.** Restaurar sobre una base
/// que ya tiene esas tablas no es un caso raro: es el más común —volver a dejar
/// desarrollo como estaba— y también el más fácil de lamentar.
/// </summary>
/// <param name="Table">Nombre calificado, como lo nombra el artefacto.</param>
/// <param name="Rows">Filas que tiene hoy en el destino, estimadas por el catálogo.</param>
public readonly record struct RestoreCollision(string Table, long? Rows);

/// <summary>
/// Lo que un artefacto dice de sí mismo, antes de aplicar nada.
///
/// Se lee sin abrir ninguna transacción y sin tocar el destino más que para
/// mirar su catálogo: inspeccionar un respaldo tiene que ser tan barato como
/// abrir un archivo, porque es lo que se hace para decidir si es el que se
/// buscaba.
/// </summary>
public sealed record RestoreInspection
{
    /// <summary>Ruta que se inspeccionó.</summary>
    public required string Path { get; init; }

    /// <summary>Cómo está repartido: un archivo, una carpeta o un `.zip`.</summary>
    public required BackupLayout Layout { get; init; }

    /// <summary>
    /// Huella de **este** artefacto, tal y como estaba al mirarlo.
    ///
    /// Quien restaura la devuelve, y si para entonces el artefacto ya no es el
    /// mismo, la restauración se para. Sin esto, entre mirar y aceptar cabe
    /// cualquier cosa: el archivo se sobrescribe, la carpeta se llena con otro
    /// respaldo, alguien mueve un `.zip` a esa ruta. Lo que se aplicaría sería
    /// otra cosa distinta de la que se aprobó, sobre una base de verdad.
    ///
    /// **No es un hash del contenido.** Un respaldo puede ocupar gigabytes y
    /// leerlo entero dos veces para eso sería pagar minutos por cada
    /// restauración: se resume lo que identifica al artefacto —qué archivos lo
    /// forman, cuánto ocupan y cuándo se tocaron—. Detecta lo que pasa de verdad;
    /// no detectaría una edición que dejara el tamaño y la fecha intactos, y eso
    /// ya no es un descuido sino alguien intentándolo a propósito, contra lo que
    /// protegen los permisos del sistema de archivos.
    /// </summary>
    public string Fingerprint { get; init; } = string.Empty;

    public bool Compressed { get; init; }

    /// <summary>El manifiesto, cuando el artefacto lo trae.</summary>
    public BackupManifest? Manifest { get; init; }

    /// <summary>Cuántas instrucciones se ejecutarían.</summary>
    public int Statements { get; init; }

    /// <summary>Tablas que el artefacto crea o llena, en el orden en que aparecen.</summary>
    public IReadOnlyList<string> Tables { get; init; } = [];

    /// <summary>Las que ya existen en el destino y se verían afectadas.</summary>
    public IReadOnlyList<RestoreCollision> Collisions { get; init; } = [];

    /// <summary>
    /// Lo que impide aplicarlo. Vacío significa que se puede seguir.
    ///
    /// Se devuelven **todos** los motivos y no solo el primero: arreglar uno para
    /// descubrir el siguiente es la peor forma de enterarse.
    /// </summary>
    public IReadOnlyList<RestoreRejection> Rejections { get; init; } = [];

    /// <summary>Cosas que conviene saber pero no impiden restaurar.</summary>
    public IReadOnlyList<BackupWarning> Warnings { get; init; } = [];

    /// <summary>
    /// De qué base venía el respaldo, si el manifiesto lo dice.
    ///
    /// Es el nombre que se propone al traérselo a una base nueva: quien copia una
    /// base a otro servidor casi siempre la quiere llamar igual.
    /// </summary>
    public string? SourceDatabase { get; init; }

    /// <summary>
    /// Las bases que ya hay en este servidor.
    ///
    /// Viajan para que la pantalla pueda decir «ese nombre ya está cogido»
    /// **mientras se escribe**, en vez de al fallar el `CREATE DATABASE` a mitad
    /// de la restauración.
    /// </summary>
    public IReadOnlyList<string> Databases { get; init; } = [];

    public bool CanRestore => Rejections.Count == 0;
}

/// <summary>
/// Dónde se paró una restauración.
///
/// Lleva **el número de instrucción** además del mensaje: es lo que permite
/// reanudar desde ahí en vez de volver a empezar, y lo que le dice al usuario
/// cuánto se aplicó antes del fallo.
/// </summary>
/// <param name="Index">Instrucción que falló, contando desde uno.</param>
/// <param name="Statement">La instrucción entera, tal y como se mandó.</param>
/// <param name="Message">Mensaje del motor, ya normalizado.</param>
public readonly record struct RestoreFailure(int Index, string Statement, string Message);

/// <summary>
/// Lo que se sabe de una restauración en marcha.
///
/// Se sirve tal cual al cliente, que lo pide cada medio segundo, igual que en el
/// respaldo y por lo mismo: el trabajo sobrevive a la ventana que lo lanzó.
/// </summary>
public sealed record RestoreProgress
{
    public required Guid Id { get; init; }

    public RestoreStep Step { get; init; }

    public RestoreOutcome Outcome { get; init; } = RestoreOutcome.Running;

    /// <summary>Objeto que se está creando o llenando, cuando se sabe.</summary>
    public string? CurrentObject { get; init; }

    public int StatementsDone { get; init; }

    public int StatementsTotal { get; init; }

    /// <summary>Filas insertadas hasta ahora, sumando todas las tablas.</summary>
    public long RowsWritten { get; init; }

    public TimeSpan Elapsed { get; init; }

    /// <summary>
    /// Hasta dónde se aplicó, para poder reanudar.
    ///
    /// Se conserva también cuando termina bien: es la respuesta a «¿qué entró?»,
    /// que es lo primero que se pregunta después de una restauración.
    /// </summary>
    public int Applied { get; init; }

    public RestoreFailure? Failure { get; init; }

    public IReadOnlyList<BackupWarning> Warnings { get; init; } = [];
}
