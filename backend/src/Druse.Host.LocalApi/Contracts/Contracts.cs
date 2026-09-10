using Druse.Domain;

namespace Druse.Host.LocalApi.Contracts;

/// <summary>
/// Contratos HTTP de la API local.
///
/// Se mantienen separados de las entidades del dominio a propósito: el contrato
/// que consume Angular puede evolucionar sin arrastrar al núcleo, y al revés.
///
/// **Ningún tipo de este archivo puede contener una contraseña de salida.** La
/// contraseña solo aparece en las peticiones de entrada, nunca en las respuestas
/// (plan §7 y §12).
/// </summary>
public sealed record ConnectionProfileDto
{
    public Guid Id { get; init; }
    public required string Name { get; init; }
    public required string Engine { get; init; }
    public required string Host { get; init; }
    public required int Port { get; init; }
    public required string Database { get; init; }

    /// <summary>Se ignora cuando <see cref="Authentication"/> es `windows`.</summary>
    public string Username { get; init; } = string.Empty;

    /// <summary>`password` o `windows`. Por omisión, usuario y contraseña.</summary>
    public string Authentication { get; init; } = nameof(AuthenticationMode.Password);

    public string Environment { get; init; } = nameof(ConnectionEnvironment.Development);
    public bool ReadOnly { get; init; }
    public string SslMode { get; init; } = nameof(Domain.SslMode.Prefer);
    public int ConnectTimeoutSeconds { get; init; } = 15;

    /// <summary>Servidor intermedio, o ausente para conectar directamente.</summary>
    public SshTunnelDto? SshTunnel { get; init; }

    /// <summary>
    /// Nombre del servidor lógico de Informix, el `INFORMIXSERVER`.
    ///
    /// Solo lo usa el motor `InformixSqli`, donde es obligatorio.
    /// </summary>
    public string? InformixServer { get; init; }
}

/// <summary>
/// Servidor SSH por el que viaja la conexión.
///
/// **Sin contraseña ni passphrase**, igual que el perfil: esos secretos viajan
/// solo en las peticiones que abren la conexión (plan §12).
/// </summary>
public sealed record SshTunnelDto
{
    public required string Host { get; init; }
    public int Port { get; init; } = 22;
    public required string Username { get; init; }

    /// <summary>`password`, `privatekey` o `keyboardinteractive`.</summary>
    public string Authentication { get; init; } = nameof(SshAuthenticationMode.Password);

    /// <summary>Ruta del archivo de clave privada. Solo con `privatekey`.</summary>
    public string PrivateKeyPath { get; init; } = string.Empty;

    public int ConnectTimeoutSeconds { get; init; } = 15;
}

/// <summary>Petición que sí lleva contraseña. Solo de entrada.</summary>
public sealed record ConnectRequest
{
    public required ConnectionProfileDto Profile { get; init; }

    /// <summary>Se usa y se descarta. No se persiste con el perfil.</summary>
    public string? Password { get; init; }

    /// <summary>Contraseña del usuario SSH, o passphrase de su clave privada.</summary>
    public string? SshSecret { get; init; }

    /// <summary>
    /// Código de un solo uso del servidor SSH.
    ///
    /// Nunca se guarda: caduca en segundos, así que guardarlo solo serviría para
    /// tener un secreto inútil en el llavero del usuario.
    /// </summary>
    public string? SshVerificationCode { get; init; }
}

public sealed record TestConnectionResponse
{
    public required bool Succeeded { get; init; }
    public string? ServerVersion { get; init; }
    public string? ErrorMessage { get; init; }
    public string? ErrorCode { get; init; }
    public required long DurationMs { get; init; }
}

/// <summary>
/// Lo que se aprendió del túnel, sin haber tocado la base de datos.
///
/// `reach` dice **hasta dónde se llegó**, que es lo que decide a quién hay que
/// pedirle el arreglo: `bastion` es cosa de la cuenta SSH, `forward` de la red
/// entre el servidor intermedio y la base.
/// </summary>
public sealed record TestTunnelResponse
{
    public required bool Succeeded { get; init; }

    /// <summary>`notconfigured`, `bastion`, `forward` o `complete`.</summary>
    public required string Reach { get; init; }

    public string? ErrorMessage { get; init; }
    public required long DurationMs { get; init; }
}

public sealed record SessionResponse
{
    public required Guid SessionId { get; init; }
    public required string Engine { get; init; }
    public required string ServerVersion { get; init; }
    public required string Database { get; init; }
    public required bool ReadOnly { get; init; }

    /// <summary>
    /// Si el motor está impidiendo escribir por su cuenta, y no solo el aviso de
    /// Druse.
    ///
    /// PostgreSQL y MySQL sí; SQL Server e Informix no tienen sesiones de solo
    /// lectura. La interfaz lo dice tal cual: enseñar el mismo candado en los
    /// cuatro sería prometer lo que solo dos cumplen.
    /// </summary>
    public bool ReadOnlyEnforcedByEngine { get; init; }
}

public sealed record DatabaseObjectDto
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Kind { get; init; }
    public string? Database { get; init; }
    public string? Schema { get; init; }
    public bool HasChildren { get; init; }
    public long? ApproximateRowCount { get; init; }
}

public sealed record DatabaseColumnDto
{
    public required string Name { get; init; }
    public required string DataType { get; init; }

    /// <summary>
    /// Con qué se pide el valor: `date`, `datetime`, `boolean`, `integer`…
    ///
    /// No es el tipo del motor, que ya viaja en `dataType`: es **qué control
    /// dibuja la interfaz**. Se calcula aquí porque la regla que traduce
    /// `timestamptz`, `datetimeoffset` o `DATETIME YEAR TO SECOND` a una familia
    /// común ya existe en el dominio, y reescribirla en el navegador sería
    /// tenerla en dos sitios que se separarían al primer motor nuevo.
    /// </summary>
    public required string InputKind { get; init; }
    public required bool IsNullable { get; init; }
    public bool IsPrimaryKey { get; init; }
    public bool IsGenerated { get; init; }
    public string? DefaultValue { get; init; }
    public required int Ordinal { get; init; }
}

public sealed record ExecuteQueryRequest
{
    public required Guid SessionId { get; init; }
    public required string Sql { get; init; }
    public string? Database { get; init; }

    /// <summary>
    /// Identificador que el cliente elige para poder cancelar.
    ///
    /// Debe enviarse **antes** de ejecutar: si lo asignara el servidor, el cliente
    /// solo lo conocería al recibir la respuesta, cuando ya no queda nada que
    /// cancelar.
    /// </summary>
    public Guid ExecutionId { get; init; }

    public int MaxRows { get; init; } = 500;
    public int TimeoutSeconds { get; init; } = 30;
    public bool ConfirmDestructive { get; init; }
}

public sealed record ResultColumnDto
{
    public required string Name { get; init; }
    public required string DataType { get; init; }

    /// <inheritdoc cref="DatabaseColumnDto.InputKind" />
    public required string InputKind { get; init; }
    public required int Ordinal { get; init; }
}

public sealed record ResultSetDto
{
    public required IReadOnlyList<ResultColumnDto> Columns { get; init; }
    public required IReadOnlyList<IReadOnlyList<string?>> Rows { get; init; }
    public bool Truncated { get; init; }
}

public sealed record QueryMessageDto
{
    public required string Text { get; init; }
    public required string Severity { get; init; }
}

public sealed record QueryErrorDto
{
    public required string Message { get; init; }
    public string? Code { get; init; }
    public int? Position { get; init; }
    public int? Line { get; init; }
}

public sealed record QueryResultResponse
{
    public required Guid ExecutionId { get; init; }
    public required string State { get; init; }
    public required IReadOnlyList<ResultSetDto> ResultSets { get; init; }
    public required IReadOnlyList<QueryMessageDto> Messages { get; init; }
    public long? RowsAffected { get; init; }
    public required long DurationMs { get; init; }
    public QueryErrorDto? Error { get; init; }
}

/// <summary>Riesgo detectado antes de ejecutar, para pedir confirmación.</summary>
public sealed record SqlRiskDto
{
    public required string Kind { get; init; }
    public required string Description { get; init; }
}

public sealed record QueryRejectedResponse
{
    public required string Reason { get; init; }
    public required string Message { get; init; }
    public required IReadOnlyList<SqlRiskDto> Risks { get; init; }
}

/// <summary>
/// Un motor disponible y lo que necesita para conectar.
///
/// Es la única lista de motores que existe. La interfaz la tenía escrita a mano
/// y **nadie llamaba a este endpoint**: la compilación ligera, que se hace sin
/// Informix, seguía ofreciéndolo en el formulario y fallaba al conectar. Ahora
/// lo que se ofrece es lo que hay registrado.
/// </summary>
public sealed record EngineDto
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required int DefaultPort { get; init; }

    /// <summary>
    /// Base desde la que se pregunta qué bases hay, cuando el perfil no dice
    /// ninguna. Vacía en los motores que conectan sin nombrar base.
    /// </summary>
    public required string DefaultDatabase { get; init; }

    public required EngineCapabilitiesDto Capabilities { get; init; }
}

/// <summary>
/// Lo que el formulario de conexión necesita saber del motor para dibujarse.
///
/// Es un recorte de lo que declara el proveedor: aquí solo viaja lo que cambia
/// la pantalla. Lo que el motor guarda de cada familia de datos se queda en el
/// servidor, porque quien lo usa —el traductor de tipos— también está allí.
/// </summary>
public sealed record EngineCapabilitiesDto
{
    /// <summary>Hay un servidor al que apuntar. Falso en los motores que son un archivo.</summary>
    public required bool RequiresHost { get; init; }

    public required bool RequiresUsername { get; init; }

    /// <summary>Hay que decir a qué base se va. Falso en los servidores.</summary>
    public required bool RequiresDatabase { get; init; }

    /// <summary>La base **es un archivo del disco**, y lo que se guarda es su ruta.</summary>
    public required bool UsesFilePath { get; init; }

    /// <summary>Druse sabe crear una base de este motor desde el formulario.</summary>
    public required bool CanCreateDatabase { get; init; }

    /// <summary>Pide además el servidor lógico. Hoy solo Informix por SQLI.</summary>
    public required bool RequiresLogicalServer { get; init; }

    /// <summary>Admite la identidad de la sesión del sistema. Hoy solo SQL Server.</summary>
    public required bool SupportsIntegratedSecurity { get; init; }

    public required bool SupportsSshTunnel { get; init; }

    public required bool SupportsTransportEncryption { get; init; }

    /// <summary>
    /// El servidor rechaza de verdad las escrituras cuando la sesión es de solo
    /// lectura. Donde es falso, lo único que hay es el aviso del analizador, y el
    /// formulario tiene que decirlo con esas palabras.
    /// </summary>
    public required bool EnforcesReadOnlySessions { get; init; }
}

// ---------------------------------------------------------------------------
// Fase 3: conexiones guardadas, historial y preferencias
// ---------------------------------------------------------------------------

/// <summary>
/// Perfil guardado tal y como lo ve el cliente.
///
/// No lleva contraseña, solo si hay una guardada: con eso basta para decidir si
/// pedirla al conectar.
/// </summary>
public sealed record SavedConnectionDto
{
    public required Guid Id { get; init; }
    public required string Name { get; init; }
    public required string Engine { get; init; }
    public required string Host { get; init; }
    public required int Port { get; init; }
    public required string Database { get; init; }
    public required string Username { get; init; }
    public required string Authentication { get; init; }
    public required string Environment { get; init; }
    public required bool ReadOnly { get; init; }

    /// <summary>`disable`, `prefer` o `require`.</summary>
    public required string SslMode { get; init; }

    public required bool HasStoredPassword { get; init; }

    /// <summary>Servidor intermedio del perfil, si tiene.</summary>
    public SshTunnelDto? SshTunnel { get; init; }

    /// <summary>Servidor lógico de Informix, cuando el motor es `InformixSqli`.</summary>
    public string? InformixServer { get; init; }

    /// <summary>Hay un secreto de SSH guardado para este perfil.</summary>
    public bool HasStoredSshSecret { get; init; }

    /// <summary>
    /// Qué salió mal con el almacén del sistema al guardar, si algo salió mal.
    ///
    /// El perfil está guardado igual —esa mitad no depende del llavero—, así que
    /// no es un error de la petición: es lo que hay que contarle al usuario sobre
    /// su contraseña. Solo aparece al guardar; al listar no tendría sentido.
    /// </summary>
    public string? SecretWarning { get; init; }
}

public sealed record SaveConnectionRequest
{
    public required ConnectionProfileDto Profile { get; init; }

    /// <summary>Se usa para guardarla en el almacén del sistema; nunca se persiste aquí.</summary>
    public string? Password { get; init; }

    /// <summary>El usuario pidió recordar la contraseña.</summary>
    public bool StorePassword { get; init; }

    /// <summary>Contraseña o passphrase del túnel, para el almacén del sistema.</summary>
    public string? SshSecret { get; init; }

    /// <summary>El usuario pidió recordar el secreto del túnel.</summary>
    public bool StoreSshSecret { get; init; }
}

/// <summary>Secretos para conexiones guardadas que no los tienen almacenados.</summary>
public sealed record OpenSavedSessionRequest
{
    public string? Password { get; init; }

    public string? SshSecret { get; init; }

    /// <summary>Código de un solo uso, que nunca se guarda.</summary>
    public string? SshVerificationCode { get; init; }
}

public sealed record SecretStoreStatusDto
{
    public required bool Available { get; init; }
    public required string Description { get; init; }
}

public sealed record QueryHistoryEntryDto
{
    public required Guid Id { get; init; }
    public Guid? ConnectionId { get; init; }
    public required string ConnectionName { get; init; }
    public required string Database { get; init; }
    public required string Sql { get; init; }
    public required DateTimeOffset ExecutedAtUtc { get; init; }
    public required long DurationMs { get; init; }
    public required bool Succeeded { get; init; }
    public long? RowCount { get; init; }
    public string? ErrorMessage { get; init; }
}

public sealed record PreferenceValueDto
{
    public required string Value { get; init; }
}

/// <summary>
/// Una pestaña del editor tal como estaba al cerrar.
///
/// Viaja con su SQL entero: es el trabajo que el usuario no llegó a ejecutar, y
/// recortarlo sería devolverle algo distinto de lo que escribió.
/// </summary>
public sealed record EditorTabDto
{
    public required string Id { get; init; }
    public required string Title { get; init; }
    public string Sql { get; init; } = string.Empty;
    public bool IsActive { get; init; }
    public bool IsDirty { get; init; }
    public string? ConnectionId { get; init; }
    public string? Database { get; init; }
    public string? FileName { get; init; }
    public string? DocumentId { get; init; }
}

/// <summary>
/// Un fragmento de SQL guardado con nombre.
///
/// El identificador lo pone el cliente: guardar de nuevo el mismo fragmento con
/// otro nombre es reemplazarlo, y crear otro es mandar otro identificador.
/// </summary>
public sealed record SqlSnippetDto
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required string Sql { get; init; }
    public DateTimeOffset? CreatedAtUtc { get; init; }
    public DateTimeOffset? UpdatedAtUtc { get; init; }
}

/// <summary>
/// Un diagrama guardado.
///
/// `model` es lo que la interfaz necesita para volver a dibujarlo —qué tablas
/// entran y dónde están—, **nunca el esquema**: las columnas y los tipos se
/// releen del catálogo cada vez que se abre.
/// </summary>
public sealed record SavedDiagramDto
{
    public required string Id { get; init; }
    public required string ConnectionId { get; init; }
    public required string Name { get; init; }
    public required string Model { get; init; }
    public DateTimeOffset? CreatedAtUtc { get; init; }
    public DateTimeOffset? UpdatedAtUtc { get; init; }
}

// ---------------------------------------------------------------------------
// Edición de filas
// ---------------------------------------------------------------------------

/// <summary>Una celda: su columna y el valor, donde `null` es NULL.</summary>
public sealed record CellValueDto
{
    public required string Column { get; init; }
    public string? Value { get; init; }
}

public sealed record RowEditDto
{
    /// <summary>Columnas de la clave primaria con el valor con el que se leyó la fila.</summary>
    public required IReadOnlyList<CellValueDto> Key { get; init; }

    public required IReadOnlyList<CellValueDto> Changes { get; init; }
}

/// <summary>
/// Cambios hechos sobre la cuadrícula.
///
/// La tabla viaja como objeto del catálogo y no como texto: así el servidor lee
/// sus columnas reales y no se fía del nombre que le manden.
/// </summary>
public sealed record RowEditRequest
{
    public required Guid SessionId { get; init; }
    public required DatabaseObjectDto Table { get; init; }
    public required IReadOnlyList<RowEditDto> Edits { get; init; }

    /// <summary>El usuario ya vio el SQL. Sin esto no se ejecuta nada.</summary>
    public bool Confirmed { get; init; }
}

/// <summary>
/// Filas a borrar, cada una señalada por su clave primaria.
///
/// Sin valores: para borrar basta con saber cuál es la fila.
/// </summary>
public sealed record RowDeleteRequest
{
    public required Guid SessionId { get; init; }
    public required DatabaseObjectDto Table { get; init; }
    public required IReadOnlyList<IReadOnlyList<CellValueDto>> Keys { get; init; }

    /// <summary>El usuario ya vio el SQL. Sin esto no se borra nada.</summary>
    public bool Confirmed { get; init; }
}

public sealed record RowEditResponse
{
    public required long RowsAffected { get; init; }
    public required long DurationMs { get; init; }

    /// <summary>Lo que se ejecutó, escrito para poder leerlo.</summary>
    public required IReadOnlyList<string> Statements { get; init; }
}

/// <summary>Los cambios no se aplicaron, con el motivo.</summary>
public sealed record RowEditRejectedResponse
{
    public required string Reason { get; init; }
    public required string Message { get; init; }
}

// ---------------------------------------------------------------------------
// Transacciones manuales
// ---------------------------------------------------------------------------

/// <summary>
/// La transacción de una conexión, tal y como la enseña la interfaz.
///
/// Lleva el nombre de la conexión y la base porque el indicador tiene que decir
/// **a qué afecta**: la transacción es de la conexión, no de la pestaña, y quien
/// la abrió en una pestaña necesita saber que lo que ejecute en otra del mismo
/// perfil también entra.
/// </summary>
public sealed record TransactionStateResponse
{
    public required Guid SessionId { get; init; }
    public required bool IsOpen { get; init; }

    /// <summary>Cuándo se abrió, en UTC. Ausente si no hay ninguna.</summary>
    public DateTimeOffset? StartedAt { get; init; }

    public DateTimeOffset? LastActivityAt { get; init; }

    public required string ConnectionName { get; init; }
    public required string Database { get; init; }
    public required string Engine { get; init; }

    /// <summary>
    /// El DDL entra en la transacción y se puede deshacer.
    ///
    /// Falso en MySQL, donde un `ALTER` queda hecho aunque después se pulse
    /// Rollback. La interfaz lo avisa; callarlo sería dejar que el usuario
    /// descubriera solo que su tabla no volvió atrás.
    /// </summary>
    public required bool DdlIsReversible { get; init; }

    /// <summary>Segundos sin actividad tras los cuales se deshace sola.</summary>
    public required int IdleTimeoutSeconds { get; init; }

    /// <summary>Se deshizo sola por inactividad, y hay que contárselo al usuario.</summary>
    public DateTimeOffset? AutoRolledBackAt { get; init; }
}

/// <summary>No se pudo iniciar, confirmar o deshacer, con el motivo.</summary>
public sealed record TransactionRejectedResponse
{
    public required string Reason { get; init; }
    public required string Message { get; init; }
}

// ---------------------------------------------------------------------------
// Diseño de tablas
// ---------------------------------------------------------------------------

/// <summary>Columna tal y como la describe quien diseña la tabla.</summary>
public sealed record TableColumnDesignDto
{
    public required string Name { get; init; }

    /// <summary>Tipo en el dialecto del motor, tal y como se escribirá.</summary>
    public required string DataType { get; init; }

    public bool IsNullable { get; init; } = true;
    public bool IsPrimaryKey { get; init; }

    /// <summary>El motor genera el valor: identidad, serial o autoincremento.</summary>
    public bool IsIdentity { get; init; }

    /// <summary>Expresión por omisión, ya escrita en SQL.</summary>
    public string? DefaultValue { get; init; }
}

/// <summary>Columna dentro de un índice, con el sentido en que se ordena.</summary>
public sealed record IndexColumnDto
{
    public required string Name { get; init; }

    /// <summary>`asc` o `desc`. Cualquier otra cosa se lee como ascendente.</summary>
    public string Direction { get; init; } = "asc";
}

public sealed record IndexDesignDto
{
    public required string Name { get; init; }
    public required IReadOnlyList<IndexColumnDto> Columns { get; init; }
    public bool IsUnique { get; init; }

    /// <summary>Columnas guardadas en la hoja sin formar parte de la clave.</summary>
    public IReadOnlyList<string> IncludedColumns { get; init; } = [];

    /// <summary>Condición que limita las filas indizadas, ya escrita en SQL.</summary>
    public string? Filter { get; init; }

    /// <summary>Estructura del índice cuando el motor ofrece varias.</summary>
    public string? Method { get; init; }
}

public sealed record ForeignKeyDesignDto
{
    public required string Name { get; init; }
    public required IReadOnlyList<string> Columns { get; init; }
    public string? ReferencedDatabase { get; init; }
    public string? ReferencedSchema { get; init; }
    public required string ReferencedTable { get; init; }
    public required IReadOnlyList<string> ReferencedColumns { get; init; }

    /// <summary>`noAction`, `cascade`, `setNull` o `setDefault`.</summary>
    public string OnDelete { get; init; } = "noAction";
    public string OnUpdate { get; init; } = "noAction";
}

public sealed record UniqueConstraintDesignDto
{
    public required string Name { get; init; }
    public required IReadOnlyList<string> Columns { get; init; }
}

public sealed record CheckConstraintDesignDto
{
    public required string Name { get; init; }
    public required string Expression { get; init; }
}

public sealed record PrimaryKeyDesignDto
{
    public string? Name { get; init; }
    public required IReadOnlyList<string> Columns { get; init; }
}

public sealed record CreateTableRequest
{
    public required Guid SessionId { get; init; }
    public string? Database { get; init; }
    public string? Schema { get; init; }
    public required string Name { get; init; }
    public required IReadOnlyList<TableColumnDesignDto> Columns { get; init; }
    public IReadOnlyList<IndexDesignDto> Indexes { get; init; } = [];
    public IReadOnlyList<ForeignKeyDesignDto> ForeignKeys { get; init; } = [];
    public IReadOnlyList<UniqueConstraintDesignDto> UniqueConstraints { get; init; } = [];
    public IReadOnlyList<CheckConstraintDesignDto> CheckConstraints { get; init; } = [];

    /// <summary>El usuario ya vio el SQL. Sin esto no se ejecuta nada.</summary>
    public bool Confirmed { get; init; }
}

/// <summary>Columna existente y cómo debe quedar.</summary>
public sealed record ColumnAlterationDto
{
    /// <summary>Nombre que la columna tiene hoy; distinto del nuevo es un renombrado.</summary>
    public required string CurrentName { get; init; }
    public required TableColumnDesignDto Column { get; init; }
}

/// <summary>Índice existente y cómo debe quedar.</summary>
public sealed record IndexAlterationDto
{
    public required string CurrentName { get; init; }
    public required IndexDesignDto Index { get; init; }
}

public sealed record AlterTableRequest
{
    public required Guid SessionId { get; init; }
    public required DatabaseObjectDto Table { get; init; }
    public string? NewName { get; init; }
    public IReadOnlyList<TableColumnDesignDto> AddedColumns { get; init; } = [];
    public IReadOnlyList<ColumnAlterationDto> AlteredColumns { get; init; } = [];
    public IReadOnlyList<string> DroppedColumns { get; init; } = [];

    public IReadOnlyList<IndexDesignDto> AddedIndexes { get; init; } = [];
    public IReadOnlyList<IndexAlterationDto> AlteredIndexes { get; init; } = [];
    public IReadOnlyList<string> DroppedIndexes { get; init; } = [];

    public IReadOnlyList<ForeignKeyDesignDto> AddedForeignKeys { get; init; } = [];
    public IReadOnlyList<string> DroppedForeignKeys { get; init; } = [];

    public IReadOnlyList<UniqueConstraintDesignDto> AddedUniqueConstraints { get; init; } = [];
    public IReadOnlyList<string> DroppedUniqueConstraints { get; init; } = [];

    public IReadOnlyList<CheckConstraintDesignDto> AddedCheckConstraints { get; init; } = [];
    public IReadOnlyList<string> DroppedCheckConstraints { get; init; } = [];

    public PrimaryKeyDesignDto? NewPrimaryKey { get; init; }
    public string? DroppedPrimaryKeyName { get; init; }

    public bool Confirmed { get; init; }

    /// <summary>Aparte de la confirmación: lo que no se deshace con otro `ALTER`.</summary>
    public bool ConfirmedDestructive { get; init; }
}

// ---------------------------------------------------------------------------
// Estructura leída del catálogo
// ---------------------------------------------------------------------------

public sealed record DatabaseIndexDto
{
    public required string Name { get; init; }
    public required IReadOnlyList<IndexColumnDto> Columns { get; init; }
    public bool IsUnique { get; init; }

    /// <summary>Lo sostiene una restricción, así que no se puede borrar suelto.</summary>
    public bool IsConstraintIndex { get; init; }
    public bool IsPrimaryKey { get; init; }
    public IReadOnlyList<string> IncludedColumns { get; init; } = [];
    public string? Filter { get; init; }
    public string? Method { get; init; }
}

public sealed record DatabaseForeignKeyDto
{
    public required string Name { get; init; }
    public required IReadOnlyList<string> Columns { get; init; }
    public string? ReferencedSchema { get; init; }
    public required string ReferencedTable { get; init; }
    public required IReadOnlyList<string> ReferencedColumns { get; init; }
    public required string OnDelete { get; init; }
    public required string OnUpdate { get; init; }
}

public sealed record DatabaseConstraintDto
{
    public required string Name { get; init; }
    public IReadOnlyList<string> Columns { get; init; } = [];

    /// <summary>Solo en las de comprobación: la condición que devuelve el motor.</summary>
    public string? Expression { get; init; }
}

public sealed record TableStructureResponse
{
    public DatabaseConstraintDto? PrimaryKey { get; init; }
    public required IReadOnlyList<DatabaseIndexDto> Indexes { get; init; }
    public required IReadOnlyList<DatabaseForeignKeyDto> ForeignKeys { get; init; }
    public required IReadOnlyList<DatabaseConstraintDto> UniqueConstraints { get; init; }
    public required IReadOnlyList<DatabaseConstraintDto> CheckConstraints { get; init; }
}

/// <summary>Las tablas cuyo grafo se quiere leer, en una sola petición.</summary>
public sealed record SchemaGraphRequest
{
    public required IReadOnlyList<DatabaseObjectDto> Tables { get; init; }
}

/// <summary>Una tabla del grafo, con todo lo que hace falta para dibujarla.</summary>
public sealed record TableDetailResponse
{
    public required DatabaseObjectDto Table { get; init; }
    public required IReadOnlyList<DatabaseColumnDto> Columns { get; init; }
    public required TableStructureResponse Structure { get; init; }
}

/// <summary>
/// Lo leído de las tablas pedidas.
///
/// `missing` no es una lista de errores: son las tablas que se pidieron y ya no
/// están en el catálogo. Un diagrama guardado hace meses las trae, y la interfaz
/// tiene que poder decir cuáles se fueron en vez de dibujar menos cajas sin
/// explicación.
/// </summary>
public sealed record SchemaGraphResponse
{
    public required IReadOnlyList<TableDetailResponse> Tables { get; init; }
    public required IReadOnlyList<DatabaseObjectDto> Missing { get; init; }

    /// <summary>
    /// Lo que Druse **supone** por el nombre de las columnas. No son claves
    /// foráneas y viajan aparte para que no se confundan con ellas.
    /// </summary>
    public required IReadOnlyList<SuggestedRelationDto> Suggestions { get; init; }
}

/// <summary>Una relación supuesta, con su motivo para poder enseñarlo.</summary>
public sealed record SuggestedRelationDto
{
    public required string FromSchema { get; init; }
    public required string FromTable { get; init; }
    public required string Column { get; init; }
    public required string ToSchema { get; init; }
    public required string ToTable { get; init; }
    public required string ReferencedColumn { get; init; }

    /// <summary>`high` se dibuja sola; `low` se cuenta y se enseña si se pide.</summary>
    public required string Confidence { get; init; }

    public required string Reason { get; init; }
}

/// <summary>
/// Un parámetro de un procedimiento, para dibujar su formulario.
///
/// `direction` viaja como texto —`input`, `output`, `inputOutput`— y no como
/// número: un contrato local se lee en el navegador y en los registros, y un 2
/// suelto no dice nada.
/// </summary>
public sealed record RoutineParameterDto
{
    public required string Name { get; init; }
    public required string DataType { get; init; }

    /// <inheritdoc cref="DatabaseColumnDto.InputKind" />
    public required string InputKind { get; init; }
    public required string Direction { get; init; }
    public int Ordinal { get; init; }

    /// <summary>Se puede omitir porque el motor pone un valor.</summary>
    public bool HasDefault { get; init; }
}

public sealed record RoutineSignatureResponse
{
    public required string Name { get; init; }
    public string? Schema { get; init; }
    public bool IsFunction { get; init; }
    public required IReadOnlyList<RoutineParameterDto> Parameters { get; init; }
    public string? ReturnType { get; init; }
}

/// <summary>
/// Lo que el motor admite al definir un índice.
///
/// El formulario se dibuja a partir de esto y no del identificador del motor:
/// así el cliente ofrece lo que hay sin saber contra qué está conectado.
/// </summary>
public sealed record IndexCapabilitiesResponse
{
    public required bool SupportsIncludedColumns { get; init; }
    public required bool SupportsFilter { get; init; }
    public required bool SupportsSortDirection { get; init; }
    public required bool SupportsCheckConstraints { get; init; }
    public required IReadOnlyList<string> Methods { get; init; }
    public required IReadOnlyList<string> ForeignKeyActions { get; init; }
}

public sealed record TableChangeResponse
{
    /// <summary>Lo que se ejecutó, escrito para poder leerlo.</summary>
    public required IReadOnlyList<string> Statements { get; init; }
    public required long DurationMs { get; init; }
}

/// <summary>Los cambios no se aplicaron, con el motivo.</summary>
public sealed record TableChangeRejectedResponse
{
    public required string Reason { get; init; }
    public required string Message { get; init; }
}

// ---------------------------------------------------------------------------
// Fase 6: exportaciones
// ---------------------------------------------------------------------------

/// <summary>
/// Petición de exportación.
///
/// Lleva el SQL y no las filas ya obtenidas: así se exporta el resultado
/// completo aunque la cuadrícula solo muestre las primeras.
/// </summary>
public sealed record ExportRequest
{
    public required Guid SessionId { get; init; }
    public required string Sql { get; init; }
    public string? Database { get; init; }

    /// <summary>Nombre sugerido, sin extensión. Se sanea antes de usarlo.</summary>
    public string? FileName { get; init; }

    /// <summary>`utf8bom`, `utf8` o `latin1`. Solo aplica a CSV.</summary>
    public string Encoding { get; init; } = "utf8bom";

    /// <summary>Separador de campos del CSV.</summary>
    public string Delimiter { get; init; } = ",";

    public bool IncludeHeaders { get; init; } = true;

    /// <summary>Texto con el que se escribe un nulo.</summary>
    public string NullText { get; init; } = "";

    public int MaxRows { get; init; } = 1_000_000;

    public int TimeoutSeconds { get; init; } = 300;

    public bool ConfirmDestructive { get; init; }
}
