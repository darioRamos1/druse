using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Reports;

/// <summary>Por qué una fuente no se pudo leer. La interfaz lo traduce por la clave.</summary>
public static class ReportSourceFailure
{
    public const string ConnectionMissing = "connection-missing";
    public const string PasswordMissing = "password-missing";
    public const string SshSecretMissing = "ssh-secret-missing";
    public const string EngineUnsupported = "engine-unsupported";
    public const string InvalidQuery = "invalid-query";
    public const string DatabaseError = "database-error";
}

public enum ReportSchemaChangeKind
{
    Missing,
    Added,
    TypeChanged,
}

public sealed record ReportSchemaChange(string Column, ReportSchemaChangeKind Kind, string? Expected, string? Actual);

public sealed record ReportSourcePreview
{
    public required string Alias { get; init; }

    public bool Succeeded => FailureCode is null;

    public string? FailureCode { get; init; }

    public string? Message { get; init; }

    public IReadOnlyList<ResultColumn> Columns { get; init; } = [];

    public IReadOnlyList<IReadOnlyList<object?>> SampleRows { get; init; } = [];

    public int RowCount { get; init; }

    /// <summary>La fuente tiene más filas o bytes que el límite: lo que se ve es una muestra.</summary>
    public bool Truncated { get; init; }

    public IReadOnlyList<ReportSchemaChange> SchemaChanges { get; init; } = [];

    public DateTimeOffset StartedAtUtc { get; init; }

    public DateTimeOffset CompletedAtUtc { get; init; }
}

public sealed record ReportJoinPreview
{
    public bool Succeeded => Message is null;

    public string? Message { get; init; }

    public IReadOnlyList<string> DuplicateKeys { get; init; } = [];

    public IReadOnlyList<ResultColumn> Columns { get; init; } = [];

    public IReadOnlyList<IReadOnlyList<object?>> SampleRows { get; init; } = [];

    public int RowCount { get; init; }

    public int MatchedRows { get; init; }

    public int UnmatchedLeftRows { get; init; }

    public int UnmatchedRightRows { get; init; }

    public IReadOnlyList<string> RepeatedColumns { get; init; } = [];

    /// <summary>Alguna fuente quedó truncada: el cruce es una muestra y no se puede guardar.</summary>
    public bool IsSample { get; init; }
}

public sealed record ReportDatabaseList(IReadOnlyList<string> Databases, string? FailureCode, string? Message);

public sealed record ReportDatasetPreview(IReadOnlyList<ReportSourcePreview> Sources, ReportJoinPreview? Join);

/// <summary>
/// Lee las fuentes de una definición, sin guardarla, y cuenta qué pasa con cada
/// una y con la unión. Un fallo de una fuente no detiene la otra: el usuario
/// necesita ver los dos diagnósticos para arreglar la definición de una vez.
/// </summary>
public sealed class ReportDatasetPreviewService(
    SavedConnectionService saved,
    ConnectionService connections,
    ReportQueryService queries,
    TimeProvider clock)
{
    public const int SampleRowLimit = 100;

    public async Task<ReportDatasetPreview> PreviewAsync(ReportDataset dataset, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dataset);
        var errors = ReportDatasetValidator.Validate(dataset with { Name = "vista previa" }, requireJoin: false);
        if (errors.Count > 0)
        {
            throw new ArgumentException(string.Join(" ", errors), nameof(dataset));
        }

        // Una tras otra: cada fuente abre su propia sesión y no merece la pena
        // competir por el túnel o el pool cuando las dos van al mismo servidor.
        var results = new List<(ReportSourcePreview Preview, TypedQueryResult? Data)>();
        foreach (var source in dataset.Sources)
        {
            results.Add(await ReadSourceAsync(source, cancellationToken));
        }

        var previews = results.Select(result => result.Preview).ToArray();

        // Sin unión todavía, cada fuente por su lado: es lo que permite elegir columnas.
        if (dataset.Sources.Count == 1 || dataset.Join is null)
        {
            return new ReportDatasetPreview(previews, null);
        }

        if (results.Any(result => result.Data is null))
        {
            return new ReportDatasetPreview(previews, new ReportJoinPreview
            {
                Message = "La unión necesita que las dos fuentes se lean bien.",
            });
        }

        return new ReportDatasetPreview(previews, Combine(dataset.Join!, results[0].Data!, results[1].Data!, cancellationToken));
    }

    private static ReportJoinPreview Combine(
        ReportJoinDefinition join, TypedQueryResult left, TypedQueryResult right, CancellationToken cancellationToken)
    {
        // La vista previa sí cruza una muestra truncada, pero lo dice. Guardarla
        // como resultado sigue prohibido en ReportJoin.
        var isSample = left.Truncated || right.Truncated;
        try
        {
            var result = ReportJoin.Combine(
                left with { Truncated = false }, right with { Truncated = false },
                join.Keys, join.Kind, join.Cardinality, cancellationToken);
            return new ReportJoinPreview
            {
                Columns = result.Columns,
                SampleRows = result.Rows.Take(SampleRowLimit).ToArray(),
                RowCount = result.Rows.Count,
                MatchedRows = left.Rows.Count - result.UnmatchedLeftRows,
                UnmatchedLeftRows = result.UnmatchedLeftRows,
                UnmatchedRightRows = result.UnmatchedRightRows,
                RepeatedColumns = result.RepeatedColumns,
                IsSample = isSample,
            };
        }
        catch (ReportJoinDuplicateKeysException exception)
        {
            return new ReportJoinPreview { Message = exception.Message, DuplicateKeys = exception.SampleKeys, IsSample = isSample };
        }
        catch (InvalidOperationException exception)
        {
            // Columnas que faltan, tipos distintos o que requieren conversión.
            return new ReportJoinPreview { Message = exception.Message, IsSample = isSample };
        }
    }

    /// <summary>
    /// Lee una fuente con las credenciales guardadas. Sin datos si falló, con el
    /// motivo en el diagnóstico: la vista previa y la actualización leen igual.
    /// </summary>
    public async Task<(ReportSourcePreview Preview, TypedQueryResult? Data)> ReadSourceAsync(
        ReportSourceDefinition source, CancellationToken cancellationToken)
    {
        var started = clock.GetUtcNow();
        ReportSourcePreview Failed(string code, string message) => new()
        {
            Alias = source.Alias,
            FailureCode = code,
            Message = message,
            StartedAtUtc = started,
            CompletedAtUtc = clock.GetUtcNow(),
        };

        var resolved = await ResolveAsync(source.ConnectionId, cancellationToken);
        if (resolved.FailureCode is not null)
        {
            return (Failed(resolved.FailureCode, resolved.Message!), null);
        }

        var (profile, credentials, ssh) = resolved.Connection!.Value;
        TypedQueryResult data;
        try
        {
            data = await queries.ReadAsync(
                profile with { Database = source.Database }, credentials, ssh, source.Sql, cancellationToken);
        }
        catch (NotSupportedException exception)
        {
            return (Failed(ReportSourceFailure.EngineUnsupported, exception.Message), null);
        }
        catch (DatabaseOperationException exception)
        {
            // Ya viene saneado por el proveedor, sin cadena de conexión.
            return (Failed(ReportSourceFailure.DatabaseError, exception.Error.Message), null);
        }
        catch (Exception exception) when (exception is InvalidOperationException or ArgumentException
            && !cancellationToken.IsCancellationRequested)
        {
            return (Failed(ReportSourceFailure.InvalidQuery, exception.Message), null);
        }

        return (new ReportSourcePreview
        {
            Alias = source.Alias,
            Columns = data.Columns,
            SampleRows = data.Rows.Take(SampleRowLimit).ToArray(),
            RowCount = data.Rows.Count,
            Truncated = data.Truncated,
            SchemaChanges = CompareSchema(source.ExpectedColumns, data.Columns),
            StartedAtUtc = started,
            CompletedAtUtc = clock.GetUtcNow(),
        }, data);
    }

    /// <summary>Bases que se pueden elegir para una fuente, con las credenciales guardadas.</summary>
    public async Task<ReportDatabaseList> ListDatabasesAsync(Guid connectionId, CancellationToken cancellationToken)
    {
        var resolved = await ResolveAsync(connectionId, cancellationToken);
        if (resolved.FailureCode is not null)
        {
            return new ReportDatabaseList([], resolved.FailureCode, resolved.Message);
        }

        var (profile, credentials, ssh) = resolved.Connection!.Value;
        try
        {
            return new ReportDatabaseList(
                await connections.ListDatabasesAsync(profile, credentials, ssh, cancellationToken), null, null);
        }
        catch (DatabaseOperationException exception)
        {
            return new ReportDatabaseList([], ReportSourceFailure.DatabaseError, exception.Error.Message);
        }
    }

    private async Task<ResolvedConnection> ResolveAsync(Guid connectionId, CancellationToken cancellationToken)
    {
        var profile = await saved.FindAsync(connectionId, cancellationToken);
        if (profile is null)
        {
            return new(null, ReportSourceFailure.ConnectionMissing,
                "La conexión de esta fuente ya no existe. Vuelve a vincularla.");
        }

        // Las mismas reglas que al abrir una conexión guardada: la autenticación
        // de Windows y los motores sin usuarios no piden contraseña.
        var needsPassword = !profile.UsesIntegratedSecurity
            && (connections.Capabilities(profile)?.RequiresUsername ?? true);
        var credentials = needsPassword
            ? await saved.GetCredentialsAsync(profile.Id, cancellationToken)
            : new DatabaseCredentials(null);
        if (needsPassword && string.IsNullOrEmpty(credentials.Password))
        {
            return new(null, ReportSourceFailure.PasswordMissing,
                "La conexión de esta fuente no tiene contraseña guardada.");
        }

        var ssh = await saved.GetSshCredentialsAsync(profile.Id, cancellationToken);
        if (profile.UsesSshTunnel
            && profile.SshTunnel!.Authentication == SshAuthenticationMode.Password
            && string.IsNullOrEmpty(ssh.Secret))
        {
            return new(null, ReportSourceFailure.SshSecretMissing,
                "La conexión de esta fuente no tiene guardada la contraseña de su túnel SSH.");
        }

        return new((profile, credentials, ssh), null, null);
    }

    private sealed record ResolvedConnection(
        (ConnectionProfile Profile, DatabaseCredentials Credentials, SshCredentials Ssh)? Connection,
        string? FailureCode,
        string? Message);

    /// <summary>Lo que cambió respecto a la última lectura válida. Vacío la primera vez.</summary>
    public static IReadOnlyList<ReportSchemaChange> CompareSchema(
        IReadOnlyList<ReportExpectedColumn> expected, IReadOnlyList<ResultColumn> actual)
    {
        if (expected.Count == 0)
        {
            return [];
        }

        var current = actual
            .GroupBy(column => column.Name, StringComparer.Ordinal)
            .ToDictionary(group => group.Key, group => group.First().ClrType, StringComparer.Ordinal);
        var changes = new List<ReportSchemaChange>();
        foreach (var column in expected)
        {
            if (!current.Remove(column.Name, out var type))
            {
                changes.Add(new(column.Name, ReportSchemaChangeKind.Missing, column.ClrType, null));
            }
            else if (type != column.ClrType)
            {
                changes.Add(new(column.Name, ReportSchemaChangeKind.TypeChanged, column.ClrType, type));
            }
        }

        changes.AddRange(current.Select(column =>
            new ReportSchemaChange(column.Key, ReportSchemaChangeKind.Added, null, column.Value)));
        return changes;
    }
}
