namespace Druse.Domain;

/// <summary>
/// Una migración guardada para repetirla.
///
/// **Guarda nombres calificados, no identificadores de sesión.** Un perfil se
/// reabre meses después, y para entonces la sesión con la que se creó hace mucho
/// que se cerró; lo que sigue significando algo es «el esquema `ventas` de la
/// conexión de producción, estas seis tablas». Al abrirlo se pregunta contra qué
/// conexiones vivas se resuelve cada extremo.
///
/// Y **sin credenciales**, igual que el perfil de respaldo: con qué usuario se
/// entra es asunto de la conexión.
/// </summary>
public sealed record TransferProfile
{
    public required Guid Id { get; init; }

    public required string Name { get; init; }

    /// <summary>
    /// Conexión de origen con la que se creó, o `null` si esa conexión se borró.
    ///
    /// No es una clave foránea a propósito: borrar una conexión no puede llevarse
    /// por delante los perfiles que se hicieron con ella, porque describen las
    /// tablas y no el acceso. Al abrir el perfil se propone, y quien lo abre puede
    /// resolverlo contra otra.
    /// </summary>
    public Guid? SourceConnectionId { get; init; }

    public string? SourceDatabase { get; init; }

    /// <summary>Esquema del que salen las tablas. Vacío en los motores que no los tienen.</summary>
    public string? SourceSchema { get; init; }

    public Guid? TargetConnectionId { get; init; }

    public string? TargetDatabase { get; init; }

    /// <summary>Esquema donde entran. Las tablas se emparejan por nombre dentro de él.</summary>
    public string? TargetSchema { get; init; }

    /// <summary>
    /// Las tablas, por su nombre y en el orden en que se eligieron.
    ///
    /// Sin esquema delante: el esquema va aparte porque puede cambiar al
    /// resolverlo —de `ventas` en desarrollo a `ventas` en producción es lo
    /// normal, pero no siempre— y repetirlo en cada tabla obligaría a corregirlo
    /// seis veces.
    /// </summary>
    public IReadOnlyList<string> Tables { get; init; } = [];

    public TransferMode Mode { get; init; } = TransferMode.Insert;

    /// <summary>Ordenar por las claves foráneas del destino antes de copiar.</summary>
    public bool Ordered { get; init; } = true;

    public bool Atomic { get; init; }

    public bool KeepIdentity { get; init; } = true;

    public int BatchSize { get; init; } = DataTransferRequest.DefaultBatchSize;

    public required DateTimeOffset CreatedAtUtc { get; init; }

    public required DateTimeOffset UpdatedAtUtc { get; init; }

    /// <summary>Cuándo se lanzó por última vez. Nulo si nunca se ha ejecutado.</summary>
    public DateTimeOffset? LastRunAtUtc { get; init; }
}

/// <summary>Una tabla del perfil que hoy existe a los dos lados.</summary>
/// <param name="Source">La del origen, tal y como está hoy en el catálogo.</param>
/// <param name="Target">La del destino con la que se empareja.</param>
public sealed record TransferProfilePair(DatabaseObject Source, DatabaseObject Target);

/// <summary>Por qué una tabla del perfil no se puede migrar hoy.</summary>
/// <param name="Table">El nombre que guardaba el perfil.</param>
/// <param name="Reason">Qué se encontró en su lugar, escrito para leerlo.</param>
public readonly record struct TransferProfileGap(string Table, string Reason);

/// <summary>
/// Un perfil traído al presente: qué de lo que pedía se puede migrar hoy y qué no.
///
/// **Las dos cosas juntas, a propósito.** Un perfil de hace medio año nombra
/// tablas que alguien borró o que aún no existen en el destino; negarse a abrirlo
/// obligaría a rehacerlo entero, y abrirlo callando las ausencias haría creer que
/// la pasada se llevó algo que no se llevó. Se abre, y se dice qué falta.
/// </summary>
public sealed record TransferProfileResolution
{
    public required TransferProfile Profile { get; init; }

    /// <summary>Las que existen a los dos lados, en el orden del perfil.</summary>
    public IReadOnlyList<TransferProfilePair> Tables { get; init; } = [];

    /// <summary>Lo que el perfil nombraba y hoy no se puede migrar.</summary>
    public IReadOnlyList<TransferProfileGap> Gaps { get; init; } = [];

    /// <summary>Si hay algo que contarle al usuario antes de lanzarlo.</summary>
    public bool HasChanges => Gaps.Count > 0;
}
