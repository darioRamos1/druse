using Druse.Application.Transfers;
using Druse.Domain;

namespace Druse.Host.LocalApi.Contracts;

/// <summary>Una tabla de un lado del traslado.</summary>
public sealed record TransferTableDto
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public string? Database { get; init; }

    public string? Schema { get; init; }

    /// <summary>Filas estimadas por el catálogo, si el cliente ya las conoce.</summary>
    public long? ApproximateRowCount { get; init; }
}

/// <summary>Qué columna del origen va a cuál del destino.</summary>
public sealed record ColumnMappingDto
{
    public required string Source { get; init; }

    /// <summary>Nulo o vacío significa «esta columna no se copia».</summary>
    public string? Target { get; init; }
}

/// <summary>Lo que se pide trasladar.</summary>
public sealed record TransferRequestDto
{
    public required Guid SourceSessionId { get; init; }

    public required TransferTableDto Source { get; init; }

    public required Guid TargetSessionId { get; init; }

    public required TransferTableDto Target { get; init; }

    public BackupFilterDto? Filter { get; init; }

    /// <summary>Vacío significa emparejar las columnas por nombre.</summary>
    public IReadOnlyList<ColumnMappingDto> Mappings { get; init; } = [];

    /// <summary>
    /// `Insert`, `Replace`, `Upsert` o `SkipExisting`.
    ///
    /// Viaja como texto igual que el resto de enumerados del contrato: el
    /// transporte no serializa enumerados de C#, y atarlos a sus nombres
    /// compilados haría que renombrar uno rompiera al cliente.
    /// </summary>
    public string Mode { get; init; } = nameof(TransferMode.Insert);

    /// <summary>Vacío significa la clave primaria del destino.</summary>
    public IReadOnlyList<string> KeyColumns { get; init; } = [];

    /// <summary>
    /// Tipos escritos a mano al crear la tabla de destino, por columna del origen.
    ///
    /// Solo se miran entre motores distintos, que es cuando hay algo que traducir.
    /// </summary>
    public IReadOnlyDictionary<string, string> TypeOverrides { get; init; } =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);

    public bool Atomic { get; init; }

    public int BatchSize { get; init; } = DataTransferRequest.DefaultBatchSize;

    public bool KeepIdentity { get; init; } = true;

    public bool Confirmed { get; init; }

    /// <summary>El nombre de la tabla escrito a mano, solo para `Replace`.</summary>
    public string? ReplaceConfirmation { get; init; }
}

/// <summary>Algo que hay que saber de una columna antes de copiarla.</summary>
public sealed record TransferIssueDto
{
    public required string Column { get; init; }

    public required string Message { get; init; }
}

/// <summary>Lo que se sabe antes de escribir nada en el destino.</summary>
public sealed record TransferPreviewDto
{
    public required IReadOnlyList<ColumnMappingDto> Mappings { get; init; }

    public IReadOnlyList<string> MissingRequired { get; init; } = [];

    public IReadOnlyList<string> UnmatchedSource { get; init; } = [];

    public IReadOnlyList<TransferIssueDto> Issues { get; init; } = [];

    public long? RowsEstimated { get; init; }

    public required string Select { get; init; }

    public IReadOnlyList<string> Statements { get; init; } = [];

    /// <summary>Con qué columnas se reconoce una fila que ya está, ya resueltas.</summary>
    public IReadOnlyList<string> KeyColumns { get; init; } = [];

    /// <summary>Qué tipo tendría cada columna al otro lado. Vacío dentro del mismo motor.</summary>
    public IReadOnlyList<TypeTranslationDto> Translations { get; init; } = [];
}

/// <summary>Cómo queda una columna al cambiar de motor.</summary>
public sealed record TypeTranslationDto
{
    public required string Column { get; init; }

    public required string SourceType { get; init; }

    public required string TargetType { get; init; }

    /// <summary>`Exact`, `Approximate` o `None`.</summary>
    public required string Fidelity { get; init; }

    /// <summary>Qué se pierde. Ausente cuando no se pierde nada.</summary>
    public string? Note { get; init; }
}

/// <summary>Por qué se paró un traslado, con lo que ya había entrado.</summary>
public sealed record TransferFailureDto
{
    public required string Message { get; init; }

    /// <summary>Filas confirmadas en el destino antes del fallo.</summary>
    public long RowsCommitted { get; init; }

    public string? Statement { get; init; }
}

/// <summary>Lo que se sabe de un traslado, para dibujar el progreso.</summary>
public sealed record TransferProgressDto
{
    public required Guid Id { get; init; }

    public required string Step { get; init; }

    public required string Outcome { get; init; }

    public string? CurrentObject { get; init; }

    public long RowsCopied { get; init; }

    /// <summary>
    /// Estimación del catálogo, o nulo cuando no la hay.
    ///
    /// Nulo significa **barra indeterminada con contador**, no cero.
    /// </summary>
    public long? RowsEstimated { get; init; }

    public long RowsSkipped { get; init; }

    public int BatchesDone { get; init; }

    public long ElapsedMilliseconds { get; init; }

    public IReadOnlyList<BackupWarningDto> Warnings { get; init; } = [];

    public TransferFailureDto? Failure { get; init; }
}

/// <summary>Traducción entre los contratos del transporte y el dominio.</summary>
internal static class TransferMapper
{
    public static DatabaseObject ToDomain(this TransferTableDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new DatabaseObject
        {
            Id = dto.Id,
            Name = dto.Name,
            Kind = DatabaseObjectKind.Table,
            Database = dto.Database,
            Schema = dto.Schema,
            ApproximateRowCount = dto.ApproximateRowCount,
        };
    }

    public static DataTransferRequest ToDomain(this TransferRequestDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new DataTransferRequest
        {
            SourceSessionId = dto.SourceSessionId,
            Source = dto.Source.ToDomain(),
            TargetSessionId = dto.TargetSessionId,
            Target = dto.Target.ToDomain(),
            Filter = dto.Filter?.ToDomain() ?? TableDataFilter.None,
            Mappings =
            [
                .. dto.Mappings.Select(mapping => new ColumnMapping(
                    mapping.Source,
                    string.IsNullOrWhiteSpace(mapping.Target) ? null : mapping.Target)),
            ],
            Mode = Parse(dto.Mode),
            KeyColumns = dto.KeyColumns,
            TypeOverrides = dto.TypeOverrides,
            Atomic = dto.Atomic,
            BatchSize = dto.BatchSize,
            KeepIdentity = dto.KeepIdentity,
            Confirmed = dto.Confirmed,
            ReplaceConfirmation = dto.ReplaceConfirmation,
        };
    }

    /// <summary>
    /// Traduce el modo, diciendo cuál no vale.
    ///
    /// Un nombre desconocido no puede acabar en el valor por omisión: pedir
    /// «vaciar y cargar» y que se inserte encima porque el texto estaba mal
    /// escrito dejaría la tabla con el doble de filas y sin decirlo.
    /// </summary>
    private static TransferMode Parse(string value) =>
        Enum.TryParse<TransferMode>(value, ignoreCase: true, out var parsed)
            ? parsed
            : throw new ArgumentException(
                $"«{value}» no es un modo de traslado válido. " +
                $"Se admiten: {string.Join(", ", Enum.GetNames<TransferMode>())}.",
                nameof(value));

    public static TransferPreviewDto ToDto(this TransferPreview preview)
    {
        ArgumentNullException.ThrowIfNull(preview);

        return new TransferPreviewDto
        {
            Mappings =
            [
                .. preview.Mappings.Select(mapping => new ColumnMappingDto
                {
                    Source = mapping.Source,
                    Target = mapping.Target,
                }),
            ],
            MissingRequired = preview.MissingRequired,
            UnmatchedSource = preview.UnmatchedSource,
            Issues =
            [
                .. preview.Issues.Select(issue => new TransferIssueDto
                {
                    Column = issue.Column,
                    Message = issue.Message,
                }),
            ],
            RowsEstimated = preview.RowsEstimated,
            Select = preview.Select,
            Statements = preview.Statements,
            KeyColumns = preview.KeyColumns,
            Translations =
            [
                .. preview.Translations.Select(translation => new TypeTranslationDto
                {
                    Column = translation.Column,
                    SourceType = translation.SourceType,
                    TargetType = translation.TargetType,
                    Fidelity = translation.Fidelity.ToString(),
                    Note = translation.Note,
                }),
            ],
        };
    }

    public static TransferProgressDto ToDto(this TransferProgress progress)
    {
        ArgumentNullException.ThrowIfNull(progress);

        return new TransferProgressDto
        {
            Id = progress.Id,
            Step = progress.Step.ToString(),
            Outcome = progress.Outcome.ToString(),
            CurrentObject = progress.CurrentObject,
            RowsCopied = progress.RowsCopied,
            RowsEstimated = progress.RowsEstimated,
            RowsSkipped = progress.RowsSkipped,
            BatchesDone = progress.BatchesDone,
            ElapsedMilliseconds = (long)progress.Elapsed.TotalMilliseconds,
            Warnings =
            [
                .. progress.Warnings.Select(warning => new BackupWarningDto
                {
                    Subject = warning.Subject,
                    Message = warning.Message,
                }),
            ],
            Failure = progress.Failure is { } failure
                ? new TransferFailureDto
                {
                    Message = failure.Message,
                    RowsCommitted = failure.RowsCommitted,
                    Statement = failure.Statement,
                }
                : null,
        };
    }
}
