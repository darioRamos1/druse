using Druse.Application.Backups;
using Druse.Domain;

namespace Druse.Host.LocalApi.Contracts;

/// <summary>Una tabla elegida para el respaldo.</summary>
public sealed record BackupTableDto
{
    public required string Id { get; init; }

    public required string Name { get; init; }

    public string? Database { get; init; }

    public string? Schema { get; init; }

    /// <summary>Filas estimadas por el catálogo, si el cliente ya las conoce.</summary>
    public long? ApproximateRowCount { get; init; }
}

/// <summary>Filtro de una tabla, tal y como llega del asistente.</summary>
public sealed record BackupFilterDto
{
    public string? Where { get; init; }

    public int? MaxRows { get; init; }

    public IReadOnlyList<string> ExcludedColumns { get; init; } = [];
}

/// <summary>Lo que se pide respaldar.</summary>
public sealed record BackupRequestDto
{
    public required Guid SessionId { get; init; }

    public required IReadOnlyList<BackupTableDto> Tables { get; init; }

    /// <summary>
    /// Lo que se aplica a las tablas que no digan otra cosa.
    ///
    /// Viaja como texto —`StructureOnly`, `StructureAndData`, `DataOnly`— igual que
    /// el resto de enumerados del contrato: el transporte no serializa enumerados
    /// de C#, y atarlos a sus nombres compilados haría que renombrar uno rompiera
    /// al cliente.
    /// </summary>
    public string DataMode { get; init; } = nameof(TableDataMode.StructureAndData);

    /// <summary>Tablas que se salen de la regla general, por su nombre calificado.</summary>
    public IReadOnlyDictionary<string, string> DataOverrides { get; init; } =
        new Dictionary<string, string>(StringComparer.Ordinal);

    public IReadOnlyDictionary<string, BackupFilterDto> Filters { get; init; } =
        new Dictionary<string, BackupFilterDto>(StringComparer.Ordinal);

    /// <summary>`SingleFile` o `FolderByKind`.</summary>
    public string Layout { get; init; } = nameof(BackupLayout.SingleFile);

    /// <summary>`Inserts` o `Csv`.</summary>
    public string DataFormat { get; init; } = nameof(BackupDataFormat.Inserts);

    public bool Compress { get; init; }

    /// <summary>
    /// Dónde se escribe.
    ///
    /// La elige el usuario con el selector del sistema y la escribe **el proceso
    /// local**: un respaldo de varios gigabytes no puede pasar por la memoria del
    /// navegador.
    /// </summary>
    public required string Destination { get; init; }
}

/// <summary>Un aviso del respaldo, para enseñarlo tal cual.</summary>
public sealed record BackupWarningDto
{
    public required string Subject { get; init; }

    public required string Message { get; init; }
}

/// <summary>Por qué se paró un respaldo, con la instrucción que lo provocó.</summary>
public sealed record BackupFailureDto
{
    public required string Subject { get; init; }

    public required string Message { get; init; }

    public string? Statement { get; init; }
}

/// <summary>Lo que se sabe de un respaldo, para dibujar el progreso.</summary>
public sealed record BackupProgressDto
{
    public required Guid Id { get; init; }

    public required string Step { get; init; }

    public required string Outcome { get; init; }

    public string? CurrentObject { get; init; }

    public int ObjectsDone { get; init; }

    public int ObjectsTotal { get; init; }

    public long RowsDone { get; init; }

    /// <summary>
    /// Estimación del catálogo, o nulo cuando no la hay.
    ///
    /// Nulo significa **barra indeterminada con contador**, no cero: una barra que
    /// llega al 90 % y se queda ahí es peor que no tener barra.
    /// </summary>
    public long? RowsEstimated { get; init; }

    public long TotalRows { get; init; }

    public long ElapsedMilliseconds { get; init; }

    public IReadOnlyList<BackupWarningDto> Warnings { get; init; } = [];

    public BackupFailureDto? Failure { get; init; }

    public string? Path { get; init; }

    public long? Bytes { get; init; }
}

/// <summary>Traducción entre los contratos del transporte y el dominio.</summary>
internal static class BackupMapper
{
    public static DatabaseObject ToDomain(this BackupTableDto dto)
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

    public static TableDataFilter ToDomain(this BackupFilterDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new TableDataFilter
        {
            Where = dto.Where,
            MaxRows = dto.MaxRows,
            ExcludedColumns = dto.ExcludedColumns,
        };
    }

    public static BackupRequest ToDomain(this BackupRequestDto dto)
    {
        ArgumentNullException.ThrowIfNull(dto);

        return new BackupRequest
        {
            SessionId = dto.SessionId,
            Tables = [.. dto.Tables.Select(table => table.ToDomain())],
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
        };
    }

    /// <summary>
    /// Traduce un valor del contrato, diciendo cuál no vale.
    ///
    /// Un nombre desconocido no puede acabar en el valor por omisión: pedir un
    /// respaldo «solo estructura» y llevarse los datos porque el texto estaba mal
    /// escrito es peor que un error.
    /// </summary>
    private static TEnum Parse<TEnum>(string value, string field)
        where TEnum : struct, Enum =>
        Enum.TryParse<TEnum>(value, ignoreCase: true, out var parsed)
            ? parsed
            : throw new ArgumentException(
                $"«{value}» no es un valor válido para {field}. " +
                $"Se admiten: {string.Join(", ", Enum.GetNames<TEnum>())}.",
                field);

    public static BackupProgressDto ToDto(this BackupProgress progress)
    {
        ArgumentNullException.ThrowIfNull(progress);

        return new BackupProgressDto
        {
            Id = progress.Id,
            Step = progress.Step.ToString(),
            Outcome = progress.Outcome.ToString(),
            CurrentObject = progress.CurrentObject,
            ObjectsDone = progress.ObjectsDone,
            ObjectsTotal = progress.ObjectsTotal,
            RowsDone = progress.RowsDone,
            RowsEstimated = progress.RowsEstimated,
            TotalRows = progress.TotalRows,
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
                ? new BackupFailureDto
                {
                    Subject = failure.Subject,
                    Message = failure.Message,
                    Statement = failure.Statement,
                }
                : null,
            Path = progress.Path,
            Bytes = progress.Bytes,
        };
    }
}
