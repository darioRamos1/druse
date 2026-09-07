using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Queries;
using Druse.Application.Tables;
using Druse.Application.Transactions;
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

        var authentication = ParseEnum(dto.Authentication, AuthenticationMode.Password);

        return new ConnectionProfile
        {
            Id = dto.Id == Guid.Empty ? Guid.NewGuid() : dto.Id,
            Name = dto.Name,
            Engine = ParseEngine(dto.Engine),
            Host = dto.Host,
            Port = dto.Port,
            Database = dto.Database,
            // Con autenticación de Windows no hay usuario que guardar: conservar el
            // que el cliente tuviera escrito lo dejaría luego en la barra de estado
            // como si fuera con el que se conectó.
            Username = authentication == AuthenticationMode.Windows ? string.Empty : dto.Username,
            Authentication = authentication,
            Environment = ParseEnum(dto.Environment, ConnectionEnvironment.Development),
            ReadOnly = dto.ReadOnly,
            SslMode = ParseEnum(dto.SslMode, SslMode.Prefer),
            ConnectTimeoutSeconds = dto.ConnectTimeoutSeconds,
            SshTunnel = dto.SshTunnel?.ToDomain(),
            InformixServer = dto.InformixServer,
        };
    }

    public static SshTunnelSettings ToDomain(this SshTunnelDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new SshTunnelSettings
        {
            Host = dto.Host,
            Port = dto.Port,
            Username = dto.Username,
            Authentication = ParseEnum(dto.Authentication, SshAuthenticationMode.Password),
            PrivateKeyPath = dto.PrivateKeyPath,
            ConnectTimeoutSeconds = dto.ConnectTimeoutSeconds,
        };
    }

    public static SshTunnelDto ToDto(this SshTunnelSettings settings)
    {
        ArgumentNullException.ThrowIfNull(settings);

        return new SshTunnelDto
        {
            Host = settings.Host,
            Port = settings.Port,
            Username = settings.Username,
            Authentication = settings.Authentication.ToString().ToLowerInvariant(),
            PrivateKeyPath = settings.PrivateKeyPath,
            ConnectTimeoutSeconds = settings.ConnectTimeoutSeconds,
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
            ReadOnlyEnforcedByEngine = session.ReadOnlyEnforcedByEngine,
        };
    }

    public static TransactionStateResponse ToResponse(this TransactionState state)
    {
        ArgumentNullException.ThrowIfNull(state);

        return new TransactionStateResponse
        {
            SessionId = state.SessionId,
            IsOpen = state.IsOpen,
            StartedAt = state.StartedAt,
            LastActivityAt = state.LastActivityAt,
            ConnectionName = state.ConnectionName,
            Database = state.Database,
            Engine = EngineId(state.Engine),
            DdlIsReversible = state.DdlIsReversible,
            IdleTimeoutSeconds = state.IdleTimeoutSeconds,
            AutoRolledBackAt = state.AutoRolledBackAt,
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

    public static TestTunnelResponse ToResponse(this TunnelTestResult result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return new TestTunnelResponse
        {
            Succeeded = result.Succeeded,
            Reach = result.Reach.ToString().ToLowerInvariant(),
            ErrorMessage = result.Error?.Message,
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
            IsGenerated = value.IsGenerated,
            DefaultValue = value.DefaultValue,
            Ordinal = value.Ordinal,
            InputKind = InputKind(value.DataType),
        };
    }

    /// <summary>
    /// Con qué control se pide un valor de este tipo.
    ///
    /// Sale de la misma clasificación que usa el editor de filas para convertir
    /// lo que se escribe, así que la interfaz pide exactamente lo que el
    /// servidor sabrá interpretar. Tenerla en dos sitios sería tenerla mal en
    /// uno de los dos.
    /// </summary>
    private static string InputKind(string dataType) =>
        ColumnValueParser.Classify(dataType) switch
        {
            ColumnFamily.Integral => "integer",
            ColumnFamily.Fractional => "decimal",
            ColumnFamily.Boolean => "boolean",
            ColumnFamily.Date => "date",
            ColumnFamily.Time => "time",
            ColumnFamily.Timestamp => "datetime",
            ColumnFamily.TimestampWithZone => "datetimeOffset",
            ColumnFamily.Binary => "binary",
            ColumnFamily.Uuid => "uuid",
            _ => "text",
        };

    public static QueryRequest ToDomain(this ExecuteQueryRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new QueryRequest
        {
            SessionId = request.SessionId,
            ExecutionId = request.ExecutionId,
            Sql = request.Sql,
            Database = request.Database,
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
    public static SavedConnectionDto ToSavedDto(
        this ConnectionProfile profile,
        bool hasStoredPassword,
        bool hasStoredSshSecret = false)
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
            Authentication = profile.Authentication.ToString().ToLowerInvariant(),
            Environment = profile.Environment.ToString().ToLowerInvariant(),
            ReadOnly = profile.ReadOnly,
            SslMode = profile.SslMode.ToString().ToLowerInvariant(),
            HasStoredPassword = hasStoredPassword,
            SshTunnel = profile.SshTunnel?.ToDto(),
            InformixServer = profile.InformixServer,
            HasStoredSshSecret = hasStoredSshSecret,
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
            Database = request.Database,
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

    public static TableColumnDefinition ToDomain(this TableColumnDesignDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new TableColumnDefinition
        {
            Name = dto.Name,
            DataType = dto.DataType,
            IsNullable = dto.IsNullable,
            IsPrimaryKey = dto.IsPrimaryKey,
            IsIdentity = dto.IsIdentity,
            DefaultValue = dto.DefaultValue,
        };
    }

    public static IndexDefinition ToDomain(this IndexDesignDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new IndexDefinition
        {
            Name = dto.Name,
            Columns =
            [
                .. dto.Columns.Select(column => new IndexColumn
                {
                    Name = column.Name,
                    Direction = ParseDirection(column.Direction),
                }),
            ],
            IsUnique = dto.IsUnique,
            IncludedColumns = dto.IncludedColumns,
            Filter = dto.Filter,
            Method = dto.Method,
        };
    }

    public static ForeignKeyDefinition ToDomain(this ForeignKeyDesignDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new ForeignKeyDefinition
        {
            Name = dto.Name,
            Columns = dto.Columns,
            ReferencedDatabase = dto.ReferencedDatabase,
            ReferencedSchema = dto.ReferencedSchema,
            ReferencedTable = dto.ReferencedTable,
            ReferencedColumns = dto.ReferencedColumns,
            OnDelete = ParseAction(dto.OnDelete),
            OnUpdate = ParseAction(dto.OnUpdate),
        };
    }

    public static UniqueConstraintDefinition ToDomain(this UniqueConstraintDesignDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new UniqueConstraintDefinition { Name = dto.Name, Columns = dto.Columns };
    }

    public static CheckConstraintDefinition ToDomain(this CheckConstraintDesignDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new CheckConstraintDefinition { Name = dto.Name, Expression = dto.Expression };
    }

    public static TableDefinition ToDomain(this CreateTableRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new TableDefinition
        {
            Database = request.Database,
            Schema = request.Schema,
            Name = request.Name,
            Columns = [.. request.Columns.Select(column => column.ToDomain())],
            Indexes = [.. request.Indexes.Select(index => index.ToDomain())],
            ForeignKeys = [.. request.ForeignKeys.Select(key => key.ToDomain())],
            UniqueConstraints = [.. request.UniqueConstraints.Select(unique => unique.ToDomain())],
            CheckConstraints = [.. request.CheckConstraints.Select(check => check.ToDomain())],
        };
    }

    public static TableAlteration ToDomain(this AlterTableRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new TableAlteration
        {
            Table = request.Table.ToDomain(),
            NewName = request.NewName,
            AddedColumns = [.. request.AddedColumns.Select(column => column.ToDomain())],
            AlteredColumns = [.. request.AlteredColumns.Select(change => new ColumnAlteration
            {
                CurrentName = change.CurrentName,
                Column = change.Column.ToDomain(),
            })],
            DroppedColumns = request.DroppedColumns,
            AddedIndexes = [.. request.AddedIndexes.Select(index => index.ToDomain())],
            AlteredIndexes = [.. request.AlteredIndexes.Select(change => new IndexAlteration
            {
                CurrentName = change.CurrentName,
                Index = change.Index.ToDomain(),
            })],
            DroppedIndexes = request.DroppedIndexes,
            AddedForeignKeys = [.. request.AddedForeignKeys.Select(key => key.ToDomain())],
            DroppedForeignKeys = request.DroppedForeignKeys,
            AddedUniqueConstraints =
                [.. request.AddedUniqueConstraints.Select(unique => unique.ToDomain())],
            DroppedUniqueConstraints = request.DroppedUniqueConstraints,
            AddedCheckConstraints =
                [.. request.AddedCheckConstraints.Select(check => check.ToDomain())],
            DroppedCheckConstraints = request.DroppedCheckConstraints,
            NewPrimaryKey = request.NewPrimaryKey is null
                ? null
                : new PrimaryKeyDefinition
                {
                    Name = request.NewPrimaryKey.Name,
                    Columns = request.NewPrimaryKey.Columns,
                },
            DroppedPrimaryKeyName = request.DroppedPrimaryKeyName,
        };
    }

    public static RowDeleteBatch ToDomain(this RowDeleteRequest request)
    {
        ArgumentNullException.ThrowIfNull(request);

        return new RowDeleteBatch
        {
            SessionId = request.SessionId,
            Table = request.Table.ToDomain(),
            Keys =
            [
                .. request.Keys.Select(key =>
                    (IReadOnlyList<CellValue>)
                        [.. key.Select(cell => new CellValue(cell.Column, cell.Value))]),
            ],
            Confirmed = request.Confirmed,
        };
    }

    public static EditorTabDto ToDto(this EditorTabState tab)
    {
        ArgumentNullException.ThrowIfNull(tab);

        return new EditorTabDto
        {
            Id = tab.Id,
            Title = tab.Title,
            Sql = tab.Sql,
            IsActive = tab.IsActive,
            IsDirty = tab.IsDirty,
            ConnectionId = tab.ConnectionId,
            Database = tab.Database,
            FileName = tab.FileName,
            DocumentId = tab.DocumentId,
        };
    }

    public static EditorTabState ToDomain(this EditorTabDto tab)
    {
        ArgumentNullException.ThrowIfNull(tab);

        return new EditorTabState
        {
            Id = tab.Id,
            Title = tab.Title,
            Sql = tab.Sql,
            IsActive = tab.IsActive,
            IsDirty = tab.IsDirty,
            ConnectionId = tab.ConnectionId,
            Database = tab.Database,
            FileName = tab.FileName,
            DocumentId = tab.DocumentId,
            SavedAtUtc = DateTimeOffset.UtcNow,
        };
    }

    public static SavedDiagramDto ToDto(this SavedDiagram diagram)
    {
        ArgumentNullException.ThrowIfNull(diagram);

        return new SavedDiagramDto
        {
            Id = diagram.Id.ToString(),
            ConnectionId = diagram.ConnectionId.ToString(),
            Name = diagram.Name,
            Model = diagram.Model,
            CreatedAtUtc = diagram.CreatedAtUtc,
            UpdatedAtUtc = diagram.UpdatedAtUtc,
        };
    }

    public static SavedDiagram ToDomain(this SavedDiagramDto diagram, Guid id)
    {
        ArgumentNullException.ThrowIfNull(diagram);

        var now = DateTimeOffset.UtcNow;

        return new SavedDiagram
        {
            Id = id,
            ConnectionId = Guid.TryParse(diagram.ConnectionId, out var connection)
                ? connection
                : Guid.Empty,
            Name = diagram.Name,
            Model = diagram.Model,
            CreatedAtUtc = diagram.CreatedAtUtc ?? now,
            UpdatedAtUtc = now,
        };
    }

    public static SqlSnippetDto ToDto(this SqlSnippet snippet)
    {
        ArgumentNullException.ThrowIfNull(snippet);

        return new SqlSnippetDto
        {
            Id = snippet.Id.ToString(),
            Name = snippet.Name,
            Sql = snippet.Sql,
            CreatedAtUtc = snippet.CreatedAtUtc,
            UpdatedAtUtc = snippet.UpdatedAtUtc,
        };
    }

    /// <summary>
    /// El identificador viene de la ruta, no del cuerpo.
    ///
    /// Es la misma regla que en los perfiles de conexión: si no coincidieran, se
    /// estaría guardando un fragmento distinto del que se cree.
    /// </summary>
    public static SqlSnippet ToDomain(this SqlSnippetDto snippet, Guid id)
    {
        ArgumentNullException.ThrowIfNull(snippet);

        var now = DateTimeOffset.UtcNow;

        return new SqlSnippet
        {
            Id = id,
            Name = snippet.Name,
            Sql = snippet.Sql,
            CreatedAtUtc = snippet.CreatedAtUtc ?? now,
            UpdatedAtUtc = now,
        };
    }

    public static RoutineSignatureResponse ToDto(this RoutineSignature signature)
    {
        ArgumentNullException.ThrowIfNull(signature);

        return new RoutineSignatureResponse
        {
            Name = signature.Name,
            Schema = signature.Schema,
            IsFunction = signature.IsFunction,
            ReturnType = signature.ReturnType,
            Parameters =
            [
                .. signature.Parameters.Select(parameter => new RoutineParameterDto
                {
                    Name = parameter.Name,
                    DataType = parameter.DataType,
                    InputKind = InputKind(parameter.DataType),
                    Direction = parameter.Direction switch
                    {
                        RoutineParameterDirection.Output => "output",
                        RoutineParameterDirection.InputOutput => "inputOutput",
                        RoutineParameterDirection.Return => "return",
                        _ => "input",
                    },
                    Ordinal = parameter.Ordinal,
                    HasDefault = parameter.HasDefault,
                }),
            ],
        };
    }

    public static SchemaGraphResponse ToResponse(this SchemaGraph graph)
    {
        ArgumentNullException.ThrowIfNull(graph);

        return new SchemaGraphResponse
        {
            Tables =
            [
                .. graph.Tables.Select(detail => new TableDetailResponse
                {
                    Table = detail.Table.ToDto(),
                    Columns = [.. detail.Columns.Select(ToDto)],
                    Structure = detail.Structure.ToResponse(),
                }),
            ],
            Missing = [.. graph.Missing.Select(ToDto)],
            Suggestions =
            [
                .. graph.Suggestions.Select(suggestion => new SuggestedRelationDto
                {
                    FromSchema = suggestion.From.Schema ?? string.Empty,
                    FromTable = suggestion.From.Name,
                    Column = suggestion.Column,
                    ToSchema = suggestion.To.Schema ?? string.Empty,
                    ToTable = suggestion.To.Name,
                    ReferencedColumn = suggestion.ReferencedColumn,
                    Confidence = suggestion.Confidence.ToString().ToLowerInvariant(),
                    Reason = suggestion.Reason,
                }),
            ],
        };
    }

    public static TableStructureResponse ToResponse(this TableStructure structure)
    {
        ArgumentNullException.ThrowIfNull(structure);

        return new TableStructureResponse
        {
            PrimaryKey = structure.PrimaryKey is null
                ? null
                : new DatabaseConstraintDto
                {
                    Name = structure.PrimaryKey.Name,
                    Columns = structure.PrimaryKey.Columns,
                },
            Indexes =
            [
                .. structure.Indexes.Select(index => new DatabaseIndexDto
                {
                    Name = index.Name,
                    Columns = [.. index.Columns.Select(ToDto)],
                    IsUnique = index.IsUnique,
                    IsConstraintIndex = index.IsConstraintIndex,
                    IsPrimaryKey = index.IsPrimaryKey,
                    IncludedColumns = index.IncludedColumns,
                    Filter = index.Filter,
                    Method = index.Method,
                }),
            ],
            ForeignKeys =
            [
                .. structure.ForeignKeys.Select(key => new DatabaseForeignKeyDto
                {
                    Name = key.Name,
                    Columns = key.Columns,
                    ReferencedSchema = key.ReferencedSchema,
                    ReferencedTable = key.ReferencedTable,
                    ReferencedColumns = key.ReferencedColumns,
                    OnDelete = Name(key.OnDelete),
                    OnUpdate = Name(key.OnUpdate),
                }),
            ],
            UniqueConstraints =
            [
                .. structure.UniqueConstraints.Select(unique => new DatabaseConstraintDto
                {
                    Name = unique.Name,
                    Columns = unique.Columns,
                }),
            ],
            CheckConstraints =
            [
                .. structure.CheckConstraints.Select(check => new DatabaseConstraintDto
                {
                    Name = check.Name,
                    Expression = check.Expression,
                }),
            ],
        };
    }

    public static IndexCapabilitiesResponse ToResponse(this IndexCapabilities capabilities)
    {
        ArgumentNullException.ThrowIfNull(capabilities);

        return new IndexCapabilitiesResponse
        {
            SupportsIncludedColumns = capabilities.SupportsIncludedColumns,
            SupportsFilter = capabilities.SupportsFilter,
            SupportsSortDirection = capabilities.SupportsSortDirection,
            SupportsCheckConstraints = capabilities.SupportsCheckConstraints,
            Methods = capabilities.Methods,
            ForeignKeyActions = [.. capabilities.ForeignKeyActions.Select(Name)],
        };
    }

    private static IndexColumnDto ToDto(IndexColumn column) => new()
    {
        Name = column.Name,
        Direction = column.Direction == IndexSortDirection.Descending ? "desc" : "asc",
    };

    /// <summary>
    /// El sentido llega como texto y lo que no se reconoce se lee ascendente.
    ///
    /// Es el orden por omisión de los tres motores, así que un valor raro produce
    /// el índice que se habría creado sin decir nada, no un error.
    /// </summary>
    private static IndexSortDirection ParseDirection(string? direction) =>
        string.Equals(direction, "desc", StringComparison.OrdinalIgnoreCase)
            ? IndexSortDirection.Descending
            : IndexSortDirection.Ascending;

    /// <summary>
    /// La acción referencial llega como texto y lo que no se reconoce no hace nada.
    ///
    /// Caer en `NoAction` ante un valor desconocido es lo seguro: rechaza el
    /// borrado en vez de propagarlo a las filas hijas.
    /// </summary>
    private static ForeignKeyAction ParseAction(string? action) => action?.ToLowerInvariant() switch
    {
        "cascade" => ForeignKeyAction.Cascade,
        "setnull" => ForeignKeyAction.SetNull,
        "setdefault" => ForeignKeyAction.SetDefault,
        _ => ForeignKeyAction.NoAction,
    };

    private static string Name(ForeignKeyAction action) => action switch
    {
        ForeignKeyAction.Cascade => "cascade",
        ForeignKeyAction.SetNull => "setNull",
        ForeignKeyAction.SetDefault => "setDefault",
        _ => "noAction",
    };

    public static TableChangeResponse ToResponse(this TableChangeResult result) => new()
    {
        Statements = result.Statements,
        DurationMs = (long)result.Duration.TotalMilliseconds,
    };

    public static TableChangeRejectedResponse ToResponse(this TableChangeRejection rejection) => new()
    {
        Reason = rejection.Reason.ToString().ToLowerInvariant(),
        Message = rejection.Message,
    };

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
            InputKind = InputKind(column.DataType),
            Ordinal = column.Ordinal,
        })],
        Rows = resultSet.Rows,
        Truncated = resultSet.Truncated,
    };

    /// <summary>
    /// Acepta el identificador del contrato y también el nombre del enumerado.
    ///
    /// Los tres primeros son alias: su identificador no se escribe igual que el
    /// nombre del enumerado. Cuando sí coinciden basta con reconocer el nombre,
    /// y ese caso general es justo lo que faltaba: Informix se anunciaba en
    /// `/api/engines` —que sale del registro de proveedores— y se rechazaba
    /// aquí, así que **el motor entero era inalcanzable desde la aplicación**
    /// aunque su proveedor estuviera cargado.
    /// </summary>
    private static DatabaseEngine ParseEngine(string value) => value?.ToLowerInvariant() switch
    {
        "postgresql" or "postgres" => DatabaseEngine.PostgreSql,
        "sqlserver" or "mssql" => DatabaseEngine.SqlServer,
        "mysql" => DatabaseEngine.MySql,
        { } other when Enum.TryParse<DatabaseEngine>(other, ignoreCase: true, out var parsed) =>
            parsed,
        _ => throw new ArgumentException($"Motor desconocido: '{value}'.", nameof(value)),
    };

    private static TEnum ParseEnum<TEnum>(string? value, TEnum fallback)
        where TEnum : struct, Enum =>
        Enum.TryParse<TEnum>(value, ignoreCase: true, out var parsed) ? parsed : fallback;
}
