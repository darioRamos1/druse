using Druse.Domain;

namespace Druse.Host.LocalApi.Contracts;

/// <summary>Qué artefacto se mira, y contra qué conexión.</summary>
public sealed record InspectRestoreDto
{
    public required Guid SessionId { get; init; }

    /// <summary>Archivo o carpeta. La elige el usuario con el selector del sistema.</summary>
    public required string Path { get; init; }
}

/// <summary>Lo que se pide restaurar.</summary>
public sealed record RestoreRequestDto
{
    public required Guid SessionId { get; init; }

    public required string Path { get; init; }

    /// <summary>Instrucción desde la que se sigue. Cero es empezar de nuevo.</summary>
    public int ResumeFrom { get; init; }

    /// <summary>
    /// Nombre de una base **nueva** donde volcar el respaldo.
    ///
    /// Vacío es lo de siempre: aplicarlo sobre la base abierta.
    /// </summary>
    public string? NewDatabase { get; init; }
}

/// <summary>Una tabla del artefacto que ya existe en el destino.</summary>
public sealed record RestoreCollisionDto
{
    public required string Table { get; init; }

    /// <summary>Filas que tiene hoy, estimadas por el catálogo.</summary>
    public long? Rows { get; init; }
}

/// <summary>Por qué no se puede restaurar, ya escrito para enseñarlo.</summary>
public sealed record RestoreRejectionDto
{
    /// <summary>`DifferentEngine`, `UnknownFormat`, `ReadOnlyConnection` o `Unreadable`.</summary>
    public required string Reason { get; init; }

    public required string Message { get; init; }
}

/// <summary>El manifiesto, tal y como se enseña antes de restaurar.</summary>
public sealed record RestoreManifestDto
{
    public int FormatVersion { get; init; }

    public required string Engine { get; init; }

    public string ServerVersion { get; init; } = string.Empty;

    public string? Database { get; init; }

    public DateTimeOffset CreatedAt { get; init; }

    public int Tables { get; init; }

    public int TablesWithData { get; init; }

    public long Rows { get; init; }

    public required string Outcome { get; init; }

    public bool ConsistentSnapshot { get; init; }
}

/// <summary>Lo que trae el artefacto y qué pasaría al aplicarlo.</summary>
public sealed record RestoreInspectionDto
{
    public required string Path { get; init; }

    public required string Layout { get; init; }

    public bool Compressed { get; init; }

    public RestoreManifestDto? Manifest { get; init; }

    public int Statements { get; init; }

    public IReadOnlyList<string> Tables { get; init; } = [];

    public IReadOnlyList<RestoreCollisionDto> Collisions { get; init; } = [];

    public IReadOnlyList<RestoreRejectionDto> Rejections { get; init; } = [];

    public IReadOnlyList<BackupWarningDto> Warnings { get; init; } = [];

    /// <summary>De qué base venía el respaldo, si el manifiesto lo dice.</summary>
    public string? SourceDatabase { get; init; }

    /// <summary>Las bases que ya hay en este servidor.</summary>
    public IReadOnlyList<string> Databases { get; init; } = [];

    public bool CanRestore { get; init; }
}

/// <summary>Dónde se paró una restauración.</summary>
public sealed record RestoreFailureDto
{
    /// <summary>Instrucción que falló, contando desde uno.</summary>
    public int Index { get; init; }

    public required string Statement { get; init; }

    public required string Message { get; init; }
}

/// <summary>Lo que se sabe de una restauración, para dibujar el progreso.</summary>
public sealed record RestoreProgressDto
{
    public required Guid Id { get; init; }

    public required string Step { get; init; }

    public required string Outcome { get; init; }

    public string? CurrentObject { get; init; }

    public int StatementsDone { get; init; }

    public int StatementsTotal { get; init; }

    public long RowsWritten { get; init; }

    public long ElapsedMilliseconds { get; init; }

    /// <summary>Hasta dónde se aplicó. Es desde donde se reanuda.</summary>
    public int Applied { get; init; }

    public RestoreFailureDto? Failure { get; init; }

    public IReadOnlyList<BackupWarningDto> Warnings { get; init; } = [];
}

/// <summary>Traducción entre el contrato de restauración y el dominio.</summary>
internal static class RestoreMapper
{
    public static RestoreInspectionDto ToDto(this RestoreInspection inspection)
    {
        ArgumentNullException.ThrowIfNull(inspection);

        return new RestoreInspectionDto
        {
            Path = inspection.Path,
            Layout = inspection.Layout.ToString(),
            Compressed = inspection.Compressed,
            Manifest = inspection.Manifest is { } manifest
                ? new RestoreManifestDto
                {
                    FormatVersion = manifest.FormatVersion,
                    Engine = manifest.Engine.ToString(),
                    ServerVersion = manifest.ServerVersion,
                    Database = manifest.Database,
                    CreatedAt = manifest.CreatedAt,
                    Tables = manifest.Tables,
                    TablesWithData = manifest.TablesWithData,
                    Rows = manifest.Rows,
                    Outcome = manifest.Outcome.ToString(),
                    ConsistentSnapshot = manifest.ConsistentSnapshot,
                }
                : null,
            Statements = inspection.Statements,
            Tables = inspection.Tables,
            Collisions =
            [
                .. inspection.Collisions.Select(collision => new RestoreCollisionDto
                {
                    Table = collision.Table,
                    Rows = collision.Rows,
                }),
            ],
            Rejections =
            [
                .. inspection.Rejections.Select(rejection => new RestoreRejectionDto
                {
                    Reason = rejection.Reason.ToString(),
                    Message = rejection.Message,
                }),
            ],
            Warnings =
            [
                .. inspection.Warnings.Select(warning => new BackupWarningDto
                {
                    Subject = warning.Subject,
                    Message = warning.Message,
                }),
            ],
            SourceDatabase = inspection.SourceDatabase,
            Databases = inspection.Databases,
            CanRestore = inspection.CanRestore,
        };
    }

    public static RestoreProgressDto ToDto(this RestoreProgress progress)
    {
        ArgumentNullException.ThrowIfNull(progress);

        return new RestoreProgressDto
        {
            Id = progress.Id,
            Step = progress.Step.ToString(),
            Outcome = progress.Outcome.ToString(),
            CurrentObject = progress.CurrentObject,
            StatementsDone = progress.StatementsDone,
            StatementsTotal = progress.StatementsTotal,
            RowsWritten = progress.RowsWritten,
            ElapsedMilliseconds = (long)progress.Elapsed.TotalMilliseconds,
            Applied = progress.Applied,
            Failure = progress.Failure is { } failure
                ? new RestoreFailureDto
                {
                    Index = failure.Index,
                    Statement = failure.Statement,
                    Message = failure.Message,
                }
                : null,
            Warnings =
            [
                .. progress.Warnings.Select(warning => new BackupWarningDto
                {
                    Subject = warning.Subject,
                    Message = warning.Message,
                }),
            ],
        };
    }
}
