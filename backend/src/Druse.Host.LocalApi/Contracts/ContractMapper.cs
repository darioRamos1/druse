using Druse.Application.Abstractions;
using Druse.Application.Queries;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Host.LocalApi.Contracts;

/// <summary>
/// Traduce entre los contratos HTTP y el dominio.
///
/// Los enumerados viajan como texto en minúsculas: un número obligaría al cliente
/// a conocer el orden de declaración, y cambiar ese orden rompería el contrato en
/// silencio.
/// </summary>
internal static class ContractMapper
{
    public static ConnectionProfile ToDomain(this ConnectionProfileDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new ConnectionProfile
        {
            Id = dto.Id == Guid.Empty ? Guid.NewGuid() : dto.Id,
            Name = dto.Name,
            Engine = ParseEngine(dto.Engine),
            Host = dto.Host,
            Port = dto.Port,
            Database = dto.Database,
            Username = dto.Username,
            Environment = ParseEnum(dto.Environment, ConnectionEnvironment.Development),
            ReadOnly = dto.ReadOnly,
            SslMode = ParseEnum(dto.SslMode, SslMode.Prefer),
            ConnectTimeoutSeconds = dto.ConnectTimeoutSeconds,
        };
    }

    public static SessionResponse ToResponse(this IDatabaseSession session)
    {
        ArgumentNullException.ThrowIfNull(session);

        return new SessionResponse
        {
            SessionId = session.Id,
            Engine = EngineId(session.Engine),
            ServerVersion = session.ServerVersion,
            Database = session.Profile.Database,
            ReadOnly = session.Profile.ReadOnly,
        };
    }

    public static TestConnectionResponse ToResponse(this TestConnectionResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new TestConnectionResponse
        {
            Succeeded = result.Succeeded,
            ServerVersion = result.ServerVersion,
            ErrorMessage = result.Error?.Message,
            ErrorCode = result.Error?.Code,
            DurationMs = (long)result.Duration.TotalMilliseconds,
        };
    }

    public static DatabaseObjectDto ToDto(this DatabaseObject value)
    {
        ArgumentNullException.ThrowIfNull(value);

        return new DatabaseObjectDto
        {
            Id = value.Id,
            Name = value.Name,
            Kind = value.Kind.ToString().ToLowerInvariant(),
            Database = value.Database,
            Schema = value.Schema,
            HasChildren = value.HasChildren,
            ApproximateRowCount = value.ApproximateRowCount,
        };
    }

    public static DatabaseObject ToDomain(this DatabaseObjectDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new DatabaseObject
        {
            Id = dto.Id,
            Name = dto.Name,
            Kind = ParseEnum(dto.Kind, DatabaseObjectKind.Folder),
            Database = dto.Database,
            Schema = dto.Schema,
            HasChildren = dto.HasChildren,
            ApproximateRowCount = dto.ApproximateRowCount,
        };
    }

    public static DatabaseColumnDto ToDto(this DatabaseColumn value)
    {
        ArgumentNullException.ThrowIfNull(value);

        return new DatabaseColumnDto
        {
            Name = value.Name,
            DataType = value.DataType,
            IsNullable = value.IsNullable,
            IsPrimaryKey = value.IsPrimaryKey,
            DefaultValue = value.DefaultValue,
            Ordinal = value.Ordinal,
        };
    }

    public static QueryRequest ToDomain(this ExecuteQueryRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new QueryRequest
        {
            SessionId = request.SessionId,
            ExecutionId = request.ExecutionId,
            Sql = request.Sql,
            MaxRows = request.MaxRows,
            TimeoutSeconds = request.TimeoutSeconds,
            DestructiveConfirmed = request.ConfirmDestructive,
        };
    }

    public static QueryResultResponse ToResponse(this QueryResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new QueryResultResponse
        {
            ExecutionId = result.ExecutionId,
            State = result.State.ToString().ToLowerInvariant(),
            ResultSets = [.. result.ResultSets.Select(ToDto)],
            Messages = [.. result.Messages.Select(message => new QueryMessageDto
            {
                Text = message.Text,
                Severity = message.Severity.ToString().ToLowerInvariant(),
            })],
            RowsAffected = result.RowsAffected,
            DurationMs = (long)result.Duration.TotalMilliseconds,
            Error = result.Error is null ? null : new QueryErrorDto
            {
                Message = result.Error.Message,
                Code = result.Error.Code,
                Position = result.Error.Position,
                Line = result.Error.Line,
            },
        };
    }

    public static QueryRejectedResponse ToResponse(this QueryRejection rejection)
    {
        ArgumentNullException.ThrowIfNull(rejection);

        return new QueryRejectedResponse
        {
            Reason = rejection.Reason.ToString().ToLowerInvariant(),
            Message = rejection.Message,
            Risks = [.. rejection.Risks.Select(risk => new SqlRiskDto
            {
                Kind = risk.Kind.ToString().ToLowerInvariant(),
                Description = risk.Description,
            })],
        };
    }

    /// <summary>Perfil guardado. Nunca incluye la contraseña, solo si existe una.</summary>
    public static SavedConnectionDto ToSavedDto(this ConnectionProfile profile, bool hasStoredPassword)
    {
        ArgumentNullException.ThrowIfNull(profile);

        return new SavedConnectionDto
        {
            Id = profile.Id,
            Name = profile.Name,
            Engine = EngineId(profile.Engine),
            Host = profile.Host,
            Port = profile.Port,
            Database = profile.Database,
            Username = profile.Username,
            Environment = profile.Environment.ToString().ToLowerInvariant(),
            ReadOnly = profile.ReadOnly,
            HasStoredPassword = hasStoredPassword,
        };
    }

    public static QueryHistoryEntryDto ToDto(this QueryHistoryEntry entry)
    {
        ArgumentNullException.ThrowIfNull(entry);

        return new QueryHistoryEntryDto
        {
            Id = entry.Id,
            ConnectionId = entry.ConnectionId,
            ConnectionName = entry.ConnectionName,
            Database = entry.Database,
            Sql = entry.Sql,
            ExecutedAtUtc = entry.ExecutedAtUtc,
            DurationMs = entry.DurationMs,
            Succeeded = entry.Succeeded,
            RowCount = entry.RowCount,
            ErrorMessage = entry.ErrorMessage,
        };
    }

    public static QueryRequest ToDomain(this ExportRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new QueryRequest
        {
            SessionId = request.SessionId,
            Sql = request.Sql,
            // Al exportar no se recorta: el límite lo aplica el exportador, que
            // es quien sabe cuántas filas caben en cada formato.
            MaxRows = int.MaxValue,
            TimeoutSeconds = request.TimeoutSeconds,
            DestructiveConfirmed = request.ConfirmDestructive,
        };
    }

    public static ExportOptions ToOptions(this ExportRequest request, ExportFormat format)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new ExportOptions
        {
            Format = format,
            Encoding = ParseEnum(request.Encoding.Replace("-", string.Empty, StringComparison.Ordinal), CsvEncoding.Utf8Bom),
            // Un separador vacío o de varios caracteres no tiene sentido en CSV.
            Delimiter = request.Delimiter.Length == 1 ? request.Delimiter[0] : ',',
            IncludeHeaders = request.IncludeHeaders,
            NullText = request.NullText,
            MaxRows = Math.Clamp(request.MaxRows, 1, 1_000_000),
        };
    }

    /// <summary>
    /// Traduce los cambios de la cuadrícula.
    ///
    /// La tabla se convierte con el mismo mapeo que el resto del catálogo: el
    /// servidor volverá a leer sus columnas antes de escribir nada.
    /// </summary>
    public static RowEditBatch ToDomain(this RowEditRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new RowEditBatch
        {
            SessionId = request.SessionId,
            Table = request.Table.ToDomain(),
            Confirmed = request.Confirmed,
            Edits = [.. request.Edits.Select(edit => new RowEdit
            {
                Key = [.. edit.Key.Select(cell => new CellValue(cell.Column, cell.Value))],
                Changes = [.. edit.Changes.Select(cell => new CellValue(cell.Column, cell.Value))],
            })],
        };
    }

    public static string EngineId(DatabaseEngine engine) => engine switch
    {
        DatabaseEngine.PostgreSql => "postgresql",
        DatabaseEngine.SqlServer => "sqlserver",
        DatabaseEngine.MySql => "mysql",
        _ => engine.ToString().ToLowerInvariant(),
    };

    public static string EngineName(DatabaseEngine engine) => engine switch
    {
        DatabaseEngine.PostgreSql => "PostgreSQL",
        DatabaseEngine.SqlServer => "SQL Server",
        DatabaseEngine.MySql => "MySQL",
        _ => engine.ToString(),
    };

    private static ResultSetDto ToDto(ResultSet resultSet) => new()
    {
        Columns = [.. resultSet.Columns.Select(column => new ResultColumnDto
        {
            Name = column.Name,
            DataType = column.DataType,
            Ordinal = column.Ordinal,
        })],
        Rows = resultSet.Rows,
        Truncated = resultSet.Truncated,
    };

    /// <summary>Acepta el identificador del contrato y también el nombre del enumerado.</summary>
    private static DatabaseEngine ParseEngine(string value) => value?.ToLowerInvariant() switch
    {
        "postgresql" or "postgres" => DatabaseEngine.PostgreSql,
        "sqlserver" or "mssql" => DatabaseEngine.SqlServer,
        "mysql" => DatabaseEngine.MySql,
        _ => throw new ArgumentException($"Motor desconocido: '{value}'.", nameof(value)),
    };

    private static TEnum ParseEnum<TEnum>(string? value, TEnum fallback)
        where TEnum : struct, Enum =>
        Enum.TryParse<TEnum>(value, ignoreCase: true, out var parsed) ? parsed : fallback;
}
