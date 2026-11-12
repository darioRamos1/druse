using System.Text.Json;
using System.Text.Json.Serialization;
using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Platform.Abstractions;
using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

public sealed class SqliteReportRunStore(IAppPaths paths) : IReportRunStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly string _databaseFile = ReportsDatabase.File(paths);

    public async Task AddAsync(ReportRun run, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(run);
        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var transaction = (SqliteTransaction)await connection.BeginTransactionAsync(cancellationToken);
        await using var command = connection.CreateCommand();
        command.Transaction = transaction;

        // El intento y la poda van juntos: el historial queda acotado aunque
        // alguien actualice cien veces seguidas, y lo de hace meses se olvida.
        command.CommandText = """
            INSERT INTO report_runs (id, dataset_id, started_utc_ticks, status, detail)
            VALUES ($id, $dataset, $started, $status, $detail);

            DELETE FROM report_runs
            WHERE dataset_id = $dataset
              AND id NOT IN (
                  SELECT id FROM report_runs
                  WHERE dataset_id = $dataset
                  ORDER BY started_utc_ticks DESC
                  LIMIT $keep);

            DELETE FROM report_runs
            WHERE dataset_id = $dataset AND started_utc_ticks < $oldest;
            """;
        command.Parameters.AddWithValue("$id", run.Id.ToString());
        command.Parameters.AddWithValue("$dataset", run.DatasetId.ToString());
        command.Parameters.AddWithValue("$started", run.StartedAtUtc.UtcTicks);
        command.Parameters.AddWithValue("$status", run.Status.ToString());
        command.Parameters.AddWithValue("$detail", JsonSerializer.Serialize(run, JsonOptions));
        command.Parameters.AddWithValue("$keep", ReportRefreshService.RunHistoryLimit);
        command.Parameters.AddWithValue("$oldest", (run.StartedAtUtc - ReportStorage.RunRetention).UtcTicks);
        await command.ExecuteNonQueryAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<ReportRun>> GetRecentAsync(
        Guid datasetId, int limit, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return [];
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT detail FROM report_runs
            WHERE dataset_id = $dataset
            ORDER BY started_utc_ticks DESC
            LIMIT $limit;
            """;
        command.Parameters.AddWithValue("$dataset", datasetId.ToString());
        command.Parameters.AddWithValue("$limit", Math.Clamp(limit, 1, ReportRefreshService.RunHistoryLimit));
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var runs = new List<ReportRun>();
        while (await reader.ReadAsync(cancellationToken))
        {
            runs.Add(JsonSerializer.Deserialize<ReportRun>(reader.GetString(0), JsonOptions)
                ?? throw new InvalidOperationException("Un intento guardado está vacío."));
        }

        return runs;
    }
}

public sealed class SqliteSavedReportStore(IAppPaths paths, TimeProvider clock) : ISavedReportStore
{
    private readonly string _databaseFile = ReportsDatabase.File(paths);

    public async Task<IReadOnlyList<SavedReport>> GetAllAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return [];
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"{Select} ORDER BY name, created_utc_ticks;";
        return await ReadAllAsync(command, cancellationToken);
    }

    public async Task<IReadOnlyList<SavedReport>> GetByDatasetAsync(Guid datasetId, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return [];
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"{Select} WHERE dataset_id = $dataset ORDER BY created_utc_ticks, name;";
        command.Parameters.AddWithValue("$dataset", datasetId.ToString());
        return await ReadAllAsync(command, cancellationToken);
    }

    public async Task<SavedReport?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return null;
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"{Select} WHERE id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        return (await ReadAllAsync(command, cancellationToken)).SingleOrDefault();
    }

    public async Task<SavedReport> SaveAsync(SavedReport report, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(report);
        var now = clock.GetUtcNow();
        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();

        // El conjunto no cambia al editar: un reporte se lleva a otro conjunto
        // creando uno nuevo, no moviendo este.
        command.CommandText = """
            INSERT INTO saved_reports (id, dataset_id, name, visual, settings, created_utc_ticks, updated_utc_ticks)
            VALUES ($id, $dataset, $name, $visual, $settings, $now, $now)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                visual = excluded.visual,
                settings = excluded.settings,
                updated_utc_ticks = excluded.updated_utc_ticks
            WHERE saved_reports.dataset_id = excluded.dataset_id
            RETURNING created_utc_ticks;
            """;
        command.Parameters.AddWithValue("$id", report.Id.ToString());
        command.Parameters.AddWithValue("$dataset", report.DatasetId.ToString());
        command.Parameters.AddWithValue("$name", report.Name.Trim());
        command.Parameters.AddWithValue("$visual", report.Visual.ToString());
        command.Parameters.AddWithValue("$settings", report.Settings);
        command.Parameters.AddWithValue("$now", now.UtcTicks);
        var created = await command.ExecuteScalarAsync(cancellationToken)
            ?? throw new ArgumentException("Ese reporte pertenece a otro conjunto de datos.", nameof(report));

        return report with
        {
            Name = report.Name.Trim(),
            CreatedAtUtc = new DateTimeOffset((long)created, TimeSpan.Zero),
            UpdatedAtUtc = now,
        };
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return;
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM saved_reports WHERE id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private const string Select = """
        SELECT id, dataset_id, name, visual, settings, created_utc_ticks, updated_utc_ticks
        FROM saved_reports
        """;

    private static async Task<IReadOnlyList<SavedReport>> ReadAllAsync(
        SqliteCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var reports = new List<SavedReport>();
        while (await reader.ReadAsync(cancellationToken))
        {
            reports.Add(new SavedReport
            {
                Id = Guid.Parse(reader.GetString(0)),
                DatasetId = Guid.Parse(reader.GetString(1)),
                Name = reader.GetString(2),
                Visual = Enum.Parse<ReportVisualKind>(reader.GetString(3)),
                Settings = reader.GetString(4),
                CreatedAtUtc = new DateTimeOffset(reader.GetInt64(5), TimeSpan.Zero),
                UpdatedAtUtc = new DateTimeOffset(reader.GetInt64(6), TimeSpan.Zero),
            });
        }

        return reports;
    }
}
