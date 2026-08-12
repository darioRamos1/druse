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
    public string? DefaultValue { get; init; }
    public required int Ordinal { get; init; }
}

public sealed record ExecuteQueryRequest
{
    public required Guid SessionId { get; init; }
    public required string Sql { get; init; }
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
