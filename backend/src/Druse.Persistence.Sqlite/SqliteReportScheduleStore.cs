using System.Text.Json;
using System.Text.Json.Serialization;
using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Platform.Abstractions;
using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

public sealed class SqliteReportScheduleStore(IAppPaths paths, TimeProvider clock) : IReportScheduleStore
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private readonly string _databaseFile = ReportsDatabase.File(paths);

    public async Task<IReadOnlyList<ReportSchedule>> GetAllAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return [];
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"{Select} ORDER BY next_utc_ticks;";
        return await ReadAllAsync(command, cancellationToken);
    }

    public async Task<ReportSchedule?> FindAsync(Guid datasetId, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return null;
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = $"{Select} WHERE dataset_id = $dataset;";
        command.Parameters.AddWithValue("$dataset", datasetId.ToString());
        return (await ReadAllAsync(command, cancellationToken)).SingleOrDefault();
    }

    public async Task<ReportSchedule> SaveAsync(ReportSchedule schedule, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(schedule);
        var now = clock.GetUtcNow();
        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();

        // El reintento pendiente era del horario viejo; lo que esté en marcha
        // sigue y se cierra con su propio horario.
        command.CommandText = """
            INSERT INTO report_schedules
                (dataset_id, rule, paused, next_utc_ticks, attempt, retry_utc_ticks, running_utc_ticks, updated_utc_ticks)
            VALUES ($dataset, $rule, $paused, $next, 0, NULL, NULL, $now)
            ON CONFLICT (dataset_id) DO UPDATE SET
                rule = excluded.rule,
                paused = excluded.paused,
                next_utc_ticks = excluded.next_utc_ticks,
                attempt = 0,
                retry_utc_ticks = NULL,
                updated_utc_ticks = excluded.updated_utc_ticks;
            """;
        command.Parameters.AddWithValue("$dataset", schedule.DatasetId.ToString());
        command.Parameters.AddWithValue("$rule", JsonSerializer.Serialize(schedule.Rule, JsonOptions));
        command.Parameters.AddWithValue("$paused", schedule.Paused ? 1 : 0);
        command.Parameters.AddWithValue("$next", schedule.NextRunUtc.UtcTicks);
        command.Parameters.AddWithValue("$now", now.UtcTicks);
        await command.ExecuteNonQueryAsync(cancellationToken);

        return await FindAsync(schedule.DatasetId, cancellationToken)
            ?? throw new InvalidOperationException("La programación no se guardó.");
    }

    public async Task DeleteAsync(Guid datasetId, CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return;
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = "DELETE FROM report_schedules WHERE dataset_id = $dataset;";
        command.Parameters.AddWithValue("$dataset", datasetId.ToString());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> TryClaimAsync(
        ReportSchedule seen, DateTimeOffset nextRunUtc, DateTimeOffset slotUtc, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(seen);
        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();

        // Todo lo leído va en el WHERE: si otro despacho, una edición o una
        // pausa llegaron antes, no cambia ninguna fila y este no ejecuta nada.
        command.CommandText = """
            UPDATE report_schedules SET
                next_utc_ticks = $next,
                retry_utc_ticks = NULL,
                running_utc_ticks = $slot
            WHERE dataset_id = $dataset
              AND paused = 0
              AND running_utc_ticks IS NULL
              AND next_utc_ticks = $seenNext
              AND retry_utc_ticks IS $seenRetry;
            """;
        command.Parameters.AddWithValue("$dataset", seen.DatasetId.ToString());
        command.Parameters.AddWithValue("$next", nextRunUtc.UtcTicks);
        command.Parameters.AddWithValue("$slot", slotUtc.UtcTicks);
        command.Parameters.AddWithValue("$seenNext", seen.NextRunUtc.UtcTicks);
        command.Parameters.AddWithValue("$seenRetry", (object?)seen.RetryAtUtc?.UtcTicks ?? DBNull.Value);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    public async Task<bool> CompleteAsync(
        Guid datasetId, DateTimeOffset slotUtc, DateTimeOffset? retryAtUtc, int attempt,
        CancellationToken cancellationToken)
    {
        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            UPDATE report_schedules SET
                running_utc_ticks = NULL,
                retry_utc_ticks = $retry,
                attempt = $attempt
            WHERE dataset_id = $dataset AND running_utc_ticks = $slot;
            """;
        command.Parameters.AddWithValue("$dataset", datasetId.ToString());
        command.Parameters.AddWithValue("$slot", slotUtc.UtcTicks);
        command.Parameters.AddWithValue("$retry", (object?)retryAtUtc?.UtcTicks ?? DBNull.Value);
        command.Parameters.AddWithValue("$attempt", attempt);
        return await command.ExecuteNonQueryAsync(cancellationToken) == 1;
    }

    private const string Select = """
        SELECT dataset_id, rule, paused, next_utc_ticks, attempt, retry_utc_ticks, running_utc_ticks, updated_utc_ticks
        FROM report_schedules
        """;

    private static async Task<IReadOnlyList<ReportSchedule>> ReadAllAsync(
        SqliteCommand command, CancellationToken cancellationToken)
    {
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var schedules = new List<ReportSchedule>();
        while (await reader.ReadAsync(cancellationToken))
        {
            schedules.Add(new ReportSchedule
            {
                DatasetId = Guid.Parse(reader.GetString(0)),
                Rule = JsonSerializer.Deserialize<ReportScheduleRule>(reader.GetString(1), JsonOptions)
                    ?? throw new InvalidOperationException("Una programación guardada está vacía."),
                Paused = reader.GetInt64(2) != 0,
                NextRunUtc = Utc(reader.GetInt64(3)),
                Attempt = reader.GetInt32(4),
                RetryAtUtc = reader.IsDBNull(5) ? null : Utc(reader.GetInt64(5)),
                RunningSlotUtc = reader.IsDBNull(6) ? null : Utc(reader.GetInt64(6)),
                UpdatedAtUtc = Utc(reader.GetInt64(7)),
            });
        }

        return schedules;
    }

    private static DateTimeOffset Utc(long ticks) => new(ticks, TimeSpan.Zero);
}
