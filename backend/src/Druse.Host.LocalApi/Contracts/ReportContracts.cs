using Druse.Application.Reports;
using Druse.Domain;

namespace Druse.Host.LocalApi.Contracts;

// Los enums viajan por nombre, como en el resto de contratos: la interfaz los
// escribe a mano y un número no dice nada si alguien reordena el enum.

public sealed record ReportExpectedColumnDto(string Name, string ClrType);

public sealed record ReportSourceDto
{
    public required string Alias { get; init; }
    public required Guid ConnectionId { get; init; }
    public required string Database { get; init; }

    /// <summary>`Sql` o `Visual`.</summary>
    public required string Mode { get; init; }
    public required string Sql { get; init; }
    public string? VisualModel { get; init; }
    public IReadOnlyList<ReportExpectedColumnDto> ExpectedColumns { get; init; } = [];
}

public sealed record ReportJoinKeyDto(string Left, string Right);

public sealed record ReportJoinDto
{
    public required IReadOnlyList<ReportJoinKeyDto> Keys { get; init; }

    /// <summary>`Inner` o `Left`.</summary>
    public required string Kind { get; init; }

    /// <summary>`OneToOne` o `ManyToOne` (la derecha es el lado «uno»).</summary>
    public required string Cardinality { get; init; }
}

public sealed record ReportDatasetDto
{
    /// <summary>En las peticiones manda el de la ruta.</summary>
    public Guid Id { get; init; }
    public required string Name { get; init; }

    /// <summary>La pone el servidor; en las peticiones se ignora.</summary>
    public long Version { get; init; }
    public required IReadOnlyList<ReportSourceDto> Sources { get; init; }
    public ReportJoinDto? Join { get; init; }
    public DateTimeOffset CreatedAtUtc { get; init; }
    public DateTimeOffset UpdatedAtUtc { get; init; }
}

public sealed record ReportSchemaChangeDto(string Column, string Kind, string? Expected, string? Actual);

public sealed record ReportSourcePreviewDto
{
    public required string Alias { get; init; }
    public required bool Succeeded { get; init; }
    public string? FailureCode { get; init; }
    public string? Message { get; init; }
    public required IReadOnlyList<ResultColumn> Columns { get; init; }
    public required IReadOnlyList<IReadOnlyList<object?>> SampleRows { get; init; }
    public int RowCount { get; init; }
    public bool Truncated { get; init; }
    public required IReadOnlyList<ReportSchemaChangeDto> SchemaChanges { get; init; }
    public DateTimeOffset StartedAtUtc { get; init; }
    public DateTimeOffset CompletedAtUtc { get; init; }
}

public sealed record ReportJoinPreviewDto
{
    public required bool Succeeded { get; init; }
    public string? Message { get; init; }
    public required IReadOnlyList<string> DuplicateKeys { get; init; }
    public required IReadOnlyList<ResultColumn> Columns { get; init; }
    public required IReadOnlyList<IReadOnlyList<object?>> SampleRows { get; init; }
    public int RowCount { get; init; }
    public int MatchedRows { get; init; }
    public int UnmatchedLeftRows { get; init; }
    public int UnmatchedRightRows { get; init; }
    public required IReadOnlyList<string> RepeatedColumns { get; init; }
    public bool IsSample { get; init; }
}

public sealed record ReportDatasetPreviewDto(
    IReadOnlyList<ReportSourcePreviewDto> Sources,
    ReportJoinPreviewDto? Join);

internal static class ReportContractMapper
{
    public static ReportDataset ToDomain(this ReportDatasetDto dto, Guid id)
    {
        ArgumentNullException.ThrowIfNull(dto);
        return new ReportDataset
        {
            Id = id,
            Name = dto.Name?.Trim() ?? string.Empty,
            Sources = (dto.Sources ?? []).Select(source => new ReportSourceDefinition
            {
                Alias = source.Alias?.Trim() ?? string.Empty,
                ConnectionId = source.ConnectionId,
                Database = source.Database ?? string.Empty,
                Mode = Parse<ReportSourceMode>(source.Mode, "modo de fuente"),
                Sql = source.Sql ?? string.Empty,
                VisualModel = source.VisualModel,
                ExpectedColumns = (source.ExpectedColumns ?? [])
                    .Select(column => new ReportExpectedColumn(column.Name, column.ClrType))
                    .ToArray(),
            }).ToArray(),
            Join = dto.Join is null ? null : new ReportJoinDefinition(
                (dto.Join.Keys ?? []).Select(key => new ReportJoinKey(key.Left, key.Right)).ToArray(),
                Parse<ReportJoinKind>(dto.Join.Kind, "tipo de unión"),
                Parse<ReportJoinCardinality>(dto.Join.Cardinality, "cardinalidad")),
        };
    }

    public static ReportDatasetDto ToDto(this ReportDataset dataset) => new()
    {
        Id = dataset.Id,
        Name = dataset.Name,
        Version = dataset.Version,
        Sources = dataset.Sources.Select(source => new ReportSourceDto
        {
            Alias = source.Alias,
            ConnectionId = source.ConnectionId,
            Database = source.Database,
            Mode = source.Mode.ToString(),
            Sql = source.Sql,
            VisualModel = source.VisualModel,
            ExpectedColumns = source.ExpectedColumns
                .Select(column => new ReportExpectedColumnDto(column.Name, column.ClrType))
                .ToArray(),
        }).ToArray(),
        Join = dataset.Join is null ? null : new ReportJoinDto
        {
            Keys = dataset.Join.Keys.Select(key => new ReportJoinKeyDto(key.Left, key.Right)).ToArray(),
            Kind = dataset.Join.Kind.ToString(),
            Cardinality = dataset.Join.Cardinality.ToString(),
        },
        CreatedAtUtc = dataset.CreatedAtUtc,
        UpdatedAtUtc = dataset.UpdatedAtUtc,
    };

    public static ReportDatasetPreviewDto ToDto(this ReportDatasetPreview preview) => new(
        preview.Sources.Select(source => new ReportSourcePreviewDto
        {
            Alias = source.Alias,
            Succeeded = source.Succeeded,
            FailureCode = source.FailureCode,
            Message = source.Message,
            Columns = source.Columns,
            SampleRows = source.SampleRows,
            RowCount = source.RowCount,
            Truncated = source.Truncated,
            SchemaChanges = source.SchemaChanges
                .Select(change => new ReportSchemaChangeDto(
                    change.Column, change.Kind.ToString(), change.Expected, change.Actual))
                .ToArray(),
            StartedAtUtc = source.StartedAtUtc,
            CompletedAtUtc = source.CompletedAtUtc,
        }).ToArray(),
        preview.Join is not { } join ? null : new ReportJoinPreviewDto
        {
            Succeeded = join.Succeeded,
            Message = join.Message,
            DuplicateKeys = join.DuplicateKeys,
            Columns = join.Columns,
            SampleRows = join.SampleRows,
            RowCount = join.RowCount,
            MatchedRows = join.MatchedRows,
            UnmatchedLeftRows = join.UnmatchedLeftRows,
            UnmatchedRightRows = join.UnmatchedRightRows,
            RepeatedColumns = join.RepeatedColumns,
            IsSample = join.IsSample,
        });

    private static T Parse<T>(string? value, string what) where T : struct, Enum =>
        Enum.TryParse<T>(value, ignoreCase: true, out var parsed) && Enum.IsDefined(parsed)
            && !int.TryParse(value, out _)
            ? parsed
            : throw new ArgumentException($"El {what} «{value}» no es válido.");
}
