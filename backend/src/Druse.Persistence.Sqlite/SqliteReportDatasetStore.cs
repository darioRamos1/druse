using System.Text.Json;
using System.Text.Json.Serialization;
using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Platform.Abstractions;
using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

public sealed class SqliteReportDatasetStore(IAppPaths paths, TimeProvider clock) : IReportDatasetStore
{
    private const int FormatVersion = 1;

    // Enums por nombre: reordenarlos no puede cambiar el sentido de una unión guardada.
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly string _databaseFile = ReportsDatabase.File(paths);

    public async Task<IReadOnlyList<ReportDataset>> GetAllAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return [];
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"{SelectColumns} ORDER BY updated_utc_ticks DESC, name;";
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var datasets = new List<ReportDataset>();
        while (await reader.ReadAsync(cancellationToken))
        {
            datasets.Add(Read(reader));
        }

        return datasets;
    }

    public async Task<ReportDataset?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return null;
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        return await FindAsync(connection, null, id, cancellationToken);
    }

    public async Task<ReportDataset> SaveAsync(ReportDataset dataset, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dataset);
        var errors = ReportDatasetValidator.Validate(dataset);
        if (errors.Count > 0)
        {
            throw new ArgumentException(string.Join(" ", errors), nameof(dataset));
        }

        var definition = JsonSerializer.Serialize(new StoredDefinition(dataset.Sources, dataset.Join), JsonOptions);
        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);

        // Inmediata: dos guardados a la vez no pueden leer la misma versión y
        // escribir los dos la siguiente.
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        var existing = await FindRawAsync(connection, transaction, dataset.Id, cancellationToken);
        var now = clock.GetUtcNow();
        var saved = dataset with
        {
            Name = dataset.Name.Trim(),
            Version = existing is null ? 1
                : existing.Value.Definition == definition ? existing.Value.Version
                : existing.Value.Version + 1,
            CreatedAtUtc = existing?.CreatedAtUtc ?? now,
            UpdatedAtUtc = now,
        };

        await using (var command = connection.CreateCommand())
        {
            command.Transaction = transaction;
            command.CommandText = """
                INSERT INTO report_datasets (
                    id, name, version, format_version, definition, created_utc_ticks, updated_utc_ticks)
                VALUES ($id, $name, $version, $format, $definition, $created, $updated)
                ON CONFLICT (id) DO UPDATE SET
                    name = excluded.name,
                    version = excluded.version,
                    format_version = excluded.format_version,
                    definition = excluded.definition,
                    updated_utc_ticks = excluded.updated_utc_ticks;
                """;
            command.Parameters.AddWithValue("$id", saved.Id.ToString());
            command.Parameters.AddWithValue("$name", saved.Name);
            command.Parameters.AddWithValue("$version", saved.Version);
            command.Parameters.AddWithValue("$format", FormatVersion);
            command.Parameters.AddWithValue("$definition", definition);
            command.Parameters.AddWithValue("$created", saved.CreatedAtUtc.UtcTicks);
            command.Parameters.AddWithValue("$updated", saved.UpdatedAtUtc.UtcTicks);
            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
        return saved;
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return;
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();

        // Juntos: un resultado, un intento o un reporte sin definición ocuparían
        // espacio que nadie puede ver ni borrar.
        command.CommandText = """
            DELETE FROM report_snapshots WHERE dataset_id = $id;
            DELETE FROM report_runs WHERE dataset_id = $id;
            DELETE FROM saved_reports WHERE dataset_id = $id;
            DELETE FROM report_schedules WHERE dataset_id = $id;
            DELETE FROM report_datasets WHERE id = $id;
            """;
        command.Parameters.AddWithValue("$id", id.ToString());
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        command.Transaction = transaction;
        await command.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    private const string SelectColumns = """
        SELECT id, name, version, format_version, definition, created_utc_ticks, updated_utc_ticks
        FROM report_datasets
        """;

    private static async Task<ReportDataset?> FindAsync(
        SqliteConnection connection, SqliteTransaction? transaction, Guid id, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = $"{SelectColumns} WHERE id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    private static async Task<(long Version, string Definition, DateTimeOffset CreatedAtUtc)?> FindRawAsync(
        SqliteConnection connection, SqliteTransaction transaction, Guid id, CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;
        command.CommandText = "SELECT version, definition, created_utc_ticks FROM report_datasets WHERE id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        return await reader.ReadAsync(cancellationToken)
            ? (reader.GetInt64(0), reader.GetString(1), new DateTimeOffset(reader.GetInt64(2), TimeSpan.Zero))
            : null;
    }

    private static ReportDataset Read(SqliteDataReader reader)
    {
        if (reader.GetInt32(3) != FormatVersion)
        {
            throw new InvalidOperationException("La definición del conjunto de datos es de una versión de Druse más nueva.");
        }

        var definition = JsonSerializer.Deserialize<StoredDefinition>(reader.GetString(4), JsonOptions)
            ?? throw new InvalidOperationException("La definición del conjunto de datos está vacía.");
        return new ReportDataset
        {
            Id = Guid.Parse(reader.GetString(0)),
            Name = reader.GetString(1),
            Version = reader.GetInt64(2),
            Sources = definition.Sources,
            Join = definition.Join,
            CreatedAtUtc = new DateTimeOffset(reader.GetInt64(5), TimeSpan.Zero),
            UpdatedAtUtc = new DateTimeOffset(reader.GetInt64(6), TimeSpan.Zero),
        };
    }

    private sealed record StoredDefinition(
        IReadOnlyList<ReportSourceDefinition> Sources,
        ReportJoinDefinition? Join);
}
