namespace Druse.Domain;

/// <summary>Qué nombra una parte de la selección guardada.</summary>
public enum BackupSelectorKind
{
    /// <summary>
    /// Un esquema entero, **incluido lo que se cree después**.
    ///
    /// Es la diferencia que importa al reutilizar un perfil seis meses más tarde:
    /// «el esquema de ventas» sigue queriendo decir lo mismo cuando alguien añade
    /// una tabla, y una lista de nombres congelada en el día que se guardó, no.
    /// </summary>
    Schema = 0,

    /// <summary>Una tabla concreta, por su nombre calificado.</summary>
    Table = 1,
}

/// <summary>
/// Una parte de lo que un perfil se lleva.
///
/// Guarda **nombres, nunca identificadores**: los del catálogo cambian al
/// recrear un objeto y los de sesión no sobreviven a cerrar la ventana. Un perfil
/// se abre meses después, quizá contra otro servidor, y lo único que sigue
/// significando lo mismo es cómo se llaman las cosas.
/// </summary>
/// <param name="Kind">Si nombra un esquema entero o una tabla suelta.</param>
/// <param name="Schema">Esquema, o la base donde el motor no los tenga aparte.</param>
/// <param name="Name">Tabla, cuando <paramref name="Kind"/> es <see cref="BackupSelectorKind.Table"/>.</param>
public readonly record struct BackupSelector(BackupSelectorKind Kind, string Schema, string? Name)
{
    /// <summary>Todo lo que cuelgue de este esquema, hoy y mañana.</summary>
    public static BackupSelector ForSchema(string schema) =>
        new(BackupSelectorKind.Schema, schema, null);

    /// <summary>Esta tabla y solo esta.</summary>
    public static BackupSelector ForTable(string schema, string name) =>
        new(BackupSelectorKind.Table, schema, name);

    /// <summary>Cómo se nombra en la pantalla y en los avisos de reconciliación.</summary>
    public string Label => Kind == BackupSelectorKind.Schema
        ? Schema
        : string.IsNullOrWhiteSpace(Schema) ? Name ?? string.Empty : $"{Schema}.{Name}";
}

/// <summary>
/// Un respaldo guardado para repetirlo.
///
/// Guarda **lo que se pidió**, no lo que resultó: la selección va como esquemas y
/// nombres de tabla, y se resuelve contra el catálogo cada vez que se abre. Un
/// perfil no es una foto de la base, es una intención.
///
/// No lleva credenciales ni sesión. La conexión va como referencia —para poder
/// ofrecer la de siempre al abrirlo—, pero el perfil se puede lanzar contra otra:
/// llevarse la estructura de producción a desarrollo es justo cambiar de destino.
/// </summary>
public sealed record BackupProfile
{
    public required Guid Id { get; init; }

    public required string Name { get; init; }

    /// <summary>
    /// Conexión con la que se creó. `null` si esa conexión ya se borró.
    ///
    /// No es una clave foránea a propósito: borrar una conexión no puede llevarse
    /// por delante los perfiles que se hicieron con ella, porque describen la
    /// base y no el acceso.
    /// </summary>
    public Guid? ConnectionId { get; init; }

    /// <summary>Base sobre la que se armó, para poder decir contra qué se guardó.</summary>
    public string? Database { get; init; }

    /// <summary>Qué se lleva, en el mismo orden en que se eligió.</summary>
    public IReadOnlyList<BackupSelector> Selection { get; init; } = [];

    /// <summary>El interruptor general, las anulaciones por tabla y sus filtros.</summary>
    public DataSelection Data { get; init; } = new();

    public BackupOutput Output { get; init; } = new();

    /// <summary>
    /// Dónde se escribió la última vez, como propuesta.
    ///
    /// Se guarda la carpeta y el nombre completos porque repetir un respaldo
    /// semanal es justo escribir donde el anterior; el asistente lo ofrece y el
    /// usuario lo cambia si quiere.
    /// </summary>
    public string Destination { get; init; } = string.Empty;

    /// <summary>
    /// Las tablas que resolvía la última vez que se guardó, por su nombre.
    ///
    /// Es lo que permite decir «esta vez se lleva tres tablas más que la
    /// anterior» cuando un esquema entero creció. Sin esta memoria, un perfil
    /// solo podría avisar de lo que falta, y crecer en silencio es tan capaz de
    /// sorprender como desaparecer: un esquema nuevo lleno de tablas de trabajo
    /// convierte un respaldo de estructura en uno de veinte gigabytes.
    /// </summary>
    public IReadOnlyList<string> KnownTables { get; init; } = [];

    public required DateTimeOffset CreatedAtUtc { get; init; }

    public required DateTimeOffset UpdatedAtUtc { get; init; }

    /// <summary>Cuándo se lanzó por última vez. Nulo si nunca se ha ejecutado.</summary>
    public DateTimeOffset? LastRunAtUtc { get; init; }
}

/// <summary>Por qué una parte de un perfil no se pudo resolver hoy.</summary>
/// <param name="Selector">Lo que el perfil pedía.</param>
/// <param name="Reason">Qué se encontró en su lugar, escrito para leerlo.</param>
public readonly record struct BackupProfileGap(BackupSelector Selector, string Reason);

/// <summary>
/// Un perfil traído al presente: lo que hoy existe de lo que pedía, y lo que no.
///
/// **Las dos cosas se devuelven juntas a propósito.** Un perfil de hace medio año
/// nombra tablas que alguien borró, y negarse a abrirlo por eso obligaría a
/// rehacerlo entero; abrirlo callando las ausencias haría creer que el respaldo
/// se llevó algo que ya no está. Se abre, y se dice qué falta.
/// </summary>
public sealed record BackupProfileResolution
{
    public required BackupProfile Profile { get; init; }

    /// <summary>Tablas que hoy existen, resueltas contra el catálogo.</summary>
    public IReadOnlyList<DatabaseObject> Tables { get; init; } = [];

    /// <summary>Lo que el perfil nombraba y ya no está.</summary>
    public IReadOnlyList<BackupProfileGap> Gaps { get; init; } = [];

    /// <summary>
    /// Tablas que aparecieron dentro de un esquema elegido entero.
    ///
    /// No es un problema —es exactamente lo que se pidió al marcar el esquema—,
    /// pero se dice: quien repite un respaldo semanal tiene derecho a saber que
    /// esta vez se lleva tres tablas más que la anterior.
    /// </summary>
    public IReadOnlyList<string> Added { get; init; } = [];

    /// <summary>Si hay algo que contarle al usuario antes de lanzarlo.</summary>
    public bool HasChanges => Gaps.Count > 0 || Added.Count > 0;
}
