using Druse.Domain;

namespace Druse.Host.LocalApi.Contracts;

/// <summary>
/// Una migración guardada, tal y como viaja.
///
/// Lo que se guarda son **nombres**: conexión, base, esquema y tablas. Ni un
/// identificador de sesión, porque un perfil se reabre meses después y para
/// entonces aquella sesión ya no existe.
/// </summary>
public sealed record TransferProfileDto
{
    /// <summary>Ausente al crear: lo pone el proceso local.</summary>
    public Guid? Id { get; init; }

    public required string Name { get; init; }

    public Guid? SourceConnectionId { get; init; }

    public string? SourceDatabase { get; init; }

    public string? SourceSchema { get; init; }

    public Guid? TargetConnectionId { get; init; }

    public string? TargetDatabase { get; init; }

    public string? TargetSchema { get; init; }

    /// <summary>Las tablas por su nombre, en el orden en que se eligieron.</summary>
    public IReadOnlyList<string> Tables { get; init; } = [];

    /// <summary>`Insert`, `Replace`, `Upsert` o `SkipExisting`.</summary>
    public string Mode { get; init; } = nameof(TransferMode.Insert);

    public bool Ordered { get; init; } = true;

    public bool Atomic { get; init; }

    public bool KeepIdentity { get; init; } = true;

    public int BatchSize { get; init; } = DataTransferRequest.DefaultBatchSize;

    // --- Solo de lectura: los pone el proceso local -------------------------

    public DateTimeOffset? CreatedAtUtc { get; init; }

    public DateTimeOffset? UpdatedAtUtc { get; init; }

    public DateTimeOffset? LastRunAtUtc { get; init; }
}

/// <summary>Contra qué conexiones vivas se abre un perfil.</summary>
public sealed record ResolveTransferProfileDto
{
    public required Guid SourceSessionId { get; init; }

    public required Guid TargetSessionId { get; init; }
}

/// <summary>Una tabla del perfil que hoy existe a los dos lados.</summary>
public sealed record TransferProfilePairDto
{
    public required TransferTableDto Source { get; init; }

    public required TransferTableDto Target { get; init; }
}

/// <summary>Lo que el perfil pedía y hoy no se puede migrar.</summary>
public sealed record TransferProfileGapDto
{
    public required string Table { get; init; }

    public required string Reason { get; init; }
}

/// <summary>El perfil traído al presente.</summary>
public sealed record TransferProfileResolutionDto
{
    public required TransferProfileDto Profile { get; init; }

    public IReadOnlyList<TransferProfilePairDto> Tables { get; init; } = [];

    public IReadOnlyList<TransferProfileGapDto> Gaps { get; init; } = [];

    /// <summary>Si hay algo que leer antes de lanzarlo.</summary>
    public bool HasChanges { get; init; }
}

/// <summary>Traducción entre los contratos del transporte y el dominio.</summary>
internal static class TransferProfileMapper
{
    public static TransferProfileDto ToDto(this TransferProfile profile)
    {
        ArgumentNullException.ThrowIfNull(profile);

        return new TransferProfileDto
        {
            Id = profile.Id,
            Name = profile.Name,
            SourceConnectionId = profile.SourceConnectionId,
            SourceDatabase = profile.SourceDatabase,
            SourceSchema = profile.SourceSchema,
            TargetConnectionId = profile.TargetConnectionId,
            TargetDatabase = profile.TargetDatabase,
            TargetSchema = profile.TargetSchema,
            Tables = profile.Tables,
            Mode = profile.Mode.ToString(),
            Ordered = profile.Ordered,
            Atomic = profile.Atomic,
            KeepIdentity = profile.KeepIdentity,
            BatchSize = profile.BatchSize,
            CreatedAtUtc = profile.CreatedAtUtc,
            UpdatedAtUtc = profile.UpdatedAtUtc,
            LastRunAtUtc = profile.LastRunAtUtc,
        };
    }

    /// <summary>
    /// El perfil que llega, con lo que ya tenía guardado.
    ///
    /// Guardar y renombrar son la misma operación, y duplicar es guardar sin
    /// identificador: lo que cambia entre ellas es qué manda el cliente, no lo que
    /// pasa aquí. La fecha de creación y la del último lanzamiento **son del
    /// perfil que ya estaba**: guardar un cambio no lo vuelve nuevo ni borra que
    /// se lanzó ayer.
    /// </summary>
    public static TransferProfile ToDomain(this TransferProfileDto dto, TransferProfile? existing)
    {
        ArgumentNullException.ThrowIfNull(dto);

        var now = DateTimeOffset.UtcNow;

        return new TransferProfile
        {
            Id = existing?.Id ?? dto.Id ?? Guid.NewGuid(),
            Name = dto.Name.Trim(),
            SourceConnectionId = dto.SourceConnectionId,
            SourceDatabase = dto.SourceDatabase,
            SourceSchema = dto.SourceSchema,
            TargetConnectionId = dto.TargetConnectionId,
            TargetDatabase = dto.TargetDatabase,
            TargetSchema = dto.TargetSchema,
            Tables = [.. dto.Tables.Where(table => !string.IsNullOrWhiteSpace(table))],
            Mode = Parse(dto.Mode),
            Ordered = dto.Ordered,
            Atomic = dto.Atomic,
            KeepIdentity = dto.KeepIdentity,
            BatchSize = dto.BatchSize,
            CreatedAtUtc = existing?.CreatedAtUtc ?? now,
            UpdatedAtUtc = now,
            LastRunAtUtc = existing?.LastRunAtUtc,
        };
    }

    public static TransferProfileResolutionDto ToDto(this TransferProfileResolution resolution)
    {
        ArgumentNullException.ThrowIfNull(resolution);

        return new TransferProfileResolutionDto
        {
            Profile = resolution.Profile.ToDto(),
            Tables =
            [
                .. resolution.Tables.Select(pair => new TransferProfilePairDto
                {
                    Source = pair.Source.ToTransferTableDto(),
                    Target = pair.Target.ToTransferTableDto(),
                }),
            ],
            Gaps =
            [
                .. resolution.Gaps.Select(gap => new TransferProfileGapDto
                {
                    Table = gap.Table,
                    Reason = gap.Reason,
                }),
            ],
            HasChanges = resolution.HasChanges,
        };
    }

    /// <summary>La tabla del catálogo, en la forma que ya usa el traslado.</summary>
    private static TransferTableDto ToTransferTableDto(this DatabaseObject table) => new()
    {
        Id = table.Id,
        Name = table.Name,
        Database = table.Database,
        Schema = table.Schema,
        ApproximateRowCount = table.ApproximateRowCount,
    };

    /// <summary>
    /// Traduce el modo, diciendo cuál no vale.
    ///
    /// Un nombre desconocido no puede acabar en el de por omisión: un perfil que
    /// pedía «vaciar y cargar» y se guarda como «añadir» duplicaría las filas la
    /// próxima vez que alguien lo lance.
    /// </summary>
    private static TransferMode Parse(string value) =>
        Enum.TryParse<TransferMode>(value, ignoreCase: true, out var parsed)
            ? parsed
            : throw new ArgumentException(
                $"«{value}» no es un modo de traslado válido. " +
                $"Se admiten: {string.Join(", ", Enum.GetNames<TransferMode>())}.",
                nameof(value));
}
