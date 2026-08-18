using Druse.Domain;

namespace Druse.Host.LocalApi.Contracts;

/// <summary>Una parte de lo que un perfil se lleva.</summary>
public sealed record BackupSelectorDto
{
    /// <summary>`Schema` —el esquema entero, incluido lo que se cree después— o `Table`.</summary>
    public string Kind { get; init; } = nameof(BackupSelectorKind.Table);

    public required string Schema { get; init; }

    /// <summary>Nombre de la tabla. Ausente cuando el selector es un esquema.</summary>
    public string? Name { get; init; }
}

/// <summary>Un perfil de respaldo, tal y como viaja por la API.</summary>
public sealed record BackupProfileDto
{
    /// <summary>Ausente al crear: lo pone el proceso local.</summary>
    public Guid? Id { get; init; }

    public required string Name { get; init; }

    public Guid? ConnectionId { get; init; }

    public string? Database { get; init; }

    public IReadOnlyList<BackupSelectorDto> Selection { get; init; } = [];

    /// <summary>`StructureOnly`, `StructureAndData` o `DataOnly`.</summary>
    public string DataMode { get; init; } = nameof(TableDataMode.StructureAndData);

    public IReadOnlyDictionary<string, string> DataOverrides { get; init; } =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public IReadOnlyDictionary<string, BackupFilterDto> Filters { get; init; } =
        new Dictionary<string, BackupFilterDto>(StringComparer.Ordinal);

    public string Layout { get; init; } = nameof(BackupLayout.SingleFile);

    public string DataFormat { get; init; } = nameof(BackupDataFormat.Inserts);

    public bool Compress { get; init; }

    public string Destination { get; init; } = string.Empty;

    /// <summary>
    /// Las tablas que resolvía al guardarlo.
    ///
    /// Lo manda el cliente porque es quien acaba de verlas en pantalla, y es la
    /// memoria con la que después se dice «esta vez se lleva tres tablas más».
    /// </summary>
    public IReadOnlyList<string> KnownTables { get; init; } = [];

    // --- Solo de lectura: los pone el proceso local -------------------------

    public DateTimeOffset? CreatedAtUtc { get; init; }

    public DateTimeOffset? UpdatedAtUtc { get; init; }

    public DateTimeOffset? LastRunAtUtc { get; init; }
}

/// <summary>Contra qué sesión se abre un perfil.</summary>
public sealed record ResolveBackupProfileDto
{
    /// <summary>
    /// La conexión con la que se resuelve, que no tiene por qué ser la de origen.
    ///
    /// Llevarse la estructura de producción a desarrollo es justo abrir el mismo
    /// perfil contra otra sesión, así que la sesión se pide aquí en vez de dar por
    /// buena la que el perfil recuerda.
    /// </summary>
    public required Guid SessionId { get; init; }
}

/// <summary>Algo que el perfil pedía y hoy no está.</summary>
public sealed record BackupProfileGapDto
{
    public required BackupSelectorDto Selector { get; init; }

    /// <summary>Cómo se le cuenta al usuario, ya escrito.</summary>
    public required string Reason { get; init; }
}

/// <summary>Un perfil traído al presente: lo que hay, lo que falta y lo que sobra.</summary>
public sealed record BackupProfileResolutionDto
{
    public required BackupProfileDto Profile { get; init; }

    /// <summary>Tablas que hoy existen, listas para el asistente.</summary>
    public IReadOnlyList<BackupTableDto> Tables { get; init; } = [];

    public IReadOnlyList<BackupProfileGapDto> Gaps { get; init; } = [];

    /// <summary>Tablas nuevas dentro de un esquema elegido entero.</summary>
    public IReadOnlyList<string> Added { get; init; } = [];
}

/// <summary>Traducción entre el contrato de perfiles y el dominio.</summary>
internal static class BackupProfileMapper
{
    /// <summary>
    /// Convierte lo que llega en un perfil guardable.
    ///
    /// Las fechas no vienen del cliente aunque el contrato las lleve: quien las
    /// pone es el proceso local. Aceptar la del cliente permitiría que un reloj
    /// mal puesto reordenara la lista de perfiles de otro modo cada día.
    /// </summary>
    public static BackupProfile ToDomain(this BackupProfileDto dto, BackupProfile? existing)
    {
        ArgumentNullException.ThrowIfNull(dto);

        var now = DateTimeOffset.UtcNow;

        return new BackupProfile
        {
            Id = existing?.Id ?? dto.Id ?? Guid.NewGuid(),
            Name = dto.Name.Trim(),
            ConnectionId = dto.ConnectionId,
            Database = dto.Database,
            Selection = [.. dto.Selection.Select(selector => selector.ToDomain())],
            Data = new DataSelection
            {
                Default = Parse<TableDataMode>(dto.DataMode, nameof(dto.DataMode)),
                Overrides = dto.DataOverrides.ToDictionary(
                    entry => entry.Key,
                    entry => Parse<TableDataMode>(entry.Value, nameof(dto.DataOverrides)),
                    StringComparer.Ordinal),
                Filters = dto.Filters.ToDictionary(
                    entry => entry.Key,
                    entry => entry.Value.ToDomain(),
                    StringComparer.Ordinal),
            },
            Output = new BackupOutput
            {
                Layout = Parse<BackupLayout>(dto.Layout, nameof(dto.Layout)),
                Data = Parse<BackupDataFormat>(dto.DataFormat, nameof(dto.DataFormat)),
                Compress = dto.Compress,
            },
            Destination = dto.Destination,
            KnownTables = dto.KnownTables,
            CreatedAtUtc = existing?.CreatedAtUtc ?? now,
            UpdatedAtUtc = now,
            LastRunAtUtc = existing?.LastRunAtUtc,
        };
    }

    public static BackupSelector ToDomain(this BackupSelectorDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        var kind = Parse<BackupSelectorKind>(dto.Kind, nameof(dto.Kind));

        if (kind == BackupSelectorKind.Table && string.IsNullOrWhiteSpace(dto.Name))
        {
            throw new ArgumentException(
                "Un selector de tabla necesita su nombre.",
                nameof(dto));
        }

        return new BackupSelector(kind, dto.Schema, dto.Name);
    }

    public static BackupProfileDto ToDto(this BackupProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);

        return new BackupProfileDto
        {
            Id = profile.Id,
            Name = profile.Name,
            ConnectionId = profile.ConnectionId,
            Database = profile.Database,
            Selection = [.. profile.Selection.Select(ToDto)],
            DataMode = profile.Data.Default.ToString(),
            DataOverrides = profile.Data.Overrides.ToDictionary(
                entry => entry.Key,
                entry => entry.Value.ToString(),
                StringComparer.Ordinal),
            Filters = profile.Data.Filters.ToDictionary(
                entry => entry.Key,
                entry => new BackupFilterDto
                {
                    Where = entry.Value.Where,
                    MaxRows = entry.Value.MaxRows,
                    ExcludedColumns = entry.Value.ExcludedColumns,
                },
                StringComparer.Ordinal),
            Layout = profile.Output.Layout.ToString(),
            DataFormat = profile.Output.Data.ToString(),
            Compress = profile.Output.Compress,
            Destination = profile.Destination,
            KnownTables = profile.KnownTables,
            CreatedAtUtc = profile.CreatedAtUtc,
            UpdatedAtUtc = profile.UpdatedAtUtc,
            LastRunAtUtc = profile.LastRunAtUtc,
        };
    }

    public static BackupSelectorDto ToDto(this BackupSelector selector) => new()
    {
        Kind = selector.Kind.ToString(),
        Schema = selector.Schema,
        Name = selector.Name,
    };

    public static BackupProfileResolutionDto ToDto(this BackupProfileResolution resolution)
    {
        ArgumentNullException.ThrowIfNull(resolution);

        return new BackupProfileResolutionDto
        {
            Profile = resolution.Profile.ToDto(),
            Tables =
            [
                .. resolution.Tables.Select(table => new BackupTableDto
                {
                    Id = table.Id,
                    Name = table.Name,
                    Database = table.Database,
                    Schema = table.Schema,
                    ApproximateRowCount = table.ApproximateRowCount,
                }),
            ],
            Gaps =
            [
                .. resolution.Gaps.Select(gap => new BackupProfileGapDto
                {
                    Selector = gap.Selector.ToDto(),
                    Reason = gap.Reason,
                }),
            ],
            Added = resolution.Added,
        };
    }

    private static TEnum Parse<TEnum>(string value, string field)
        where TEnum : struct, Enum =>
        Enum.TryParse<TEnum>(value, ignoreCase: true, out var parsed)
            ? parsed
            : throw new ArgumentException(
                $"«{value}» no es un valor válido para {field}. " +
                $"Se admiten: {string.Join(", ", Enum.GetNames<TEnum>())}.",
                field);
}
