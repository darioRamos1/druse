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
    public required string Username { get; init; }
    public string Environment { get; init; } = nameof(ConnectionEnvironment.Development);
    public bool ReadOnly { get; init; }
    public string SslMode { get; init; } = nameof(Domain.SslMode.Prefer);
    public int ConnectTimeoutSeconds { get; init; } = 15;
}

/// <summary>Petición que sí lleva contraseña. Solo de entrada.</summary>
public sealed record ConnectRequest
{
    public required ConnectionProfileDto Profile { get; init; }

    /// <summary>Se usa y se descarta. No se persiste con el perfil.</summary>
    public string? Password { get; init; }
}

public sealed record TestConnectionResponse
{
    public required bool Succeeded { get; init; }
    public string? ServerVersion { get; init; }
    public string? ErrorMessage { get; init; }
    public string? ErrorCode { get; init; }
    public required long DurationMs { get; init; }
}

public sealed record SessionResponse
{
    public required Guid SessionId { get; init; }
    public required string Engine { get; init; }
    public required string ServerVersion { get; init; }
    public required string Database { get; init; }
    public required bool ReadOnly { get; init; }
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

public sealed record EngineDto
{
    public required string Id { get; init; }
    public required string Name { get; init; }
    public required int DefaultPort { get; init; }
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
    public required string Environment { get; init; }
    public required bool ReadOnly { get; init; }
    public required bool HasStoredPassword { get; init; }
}

public sealed record SaveConnectionRequest
{
    public required ConnectionProfileDto Profile { get; init; }

    /// <summary>Se usa para guardarla en el almacén del sistema; nunca se persiste aquí.</summary>
    public string? Password { get; init; }

    /// <summary>El usuario pidió recordar la contraseña.</summary>
    public bool StorePassword { get; init; }
}

/// <summary>Contraseña para conexiones sin credencial guardada.</summary>
public sealed record OpenSavedSessionRequest
{
    public string? Password { get; init; }
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
