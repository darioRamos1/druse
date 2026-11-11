using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Platform.Abstractions;

namespace Druse.Persistence.Sqlite;

public sealed class SqliteReportDashboardStore(IAppPaths paths, TimeProvider clock) : IReportDashboardStore
{
    private readonly string _databaseFile = ReportsDatabase.File(paths);

    public async Task<IReadOnlyList<ReportDashboard>> GetAllAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return [];
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, model, created_utc_ticks, updated_utc_ticks
            FROM report_dashboards
            ORDER BY updated_utc_ticks DESC, name;
            """;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var dashboards = new List<ReportDashboard>();
        while (await reader.ReadAsync(cancellationToken))
        {
            dashboards.Add(new ReportDashboard
            {
                Id = Guid.Parse(reader.GetString(0)),
                Name = reader.GetString(1),
                Model = reader.GetString(2),
                CreatedAtUtc = new DateTimeOffset(reader.GetInt64(3), TimeSpan.Zero),
                UpdatedAtUtc = new DateTimeOffset(reader.GetInt64(4), TimeSpan.Zero),
            });
        }

        return dashboards;
    }

    public async Task<ReportDashboard> SaveAsync(ReportDashboard dashboard, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(dashboard);
        var now = clock.GetUtcNow();
        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO report_dashboards (id, name, model, created_utc_ticks, updated_utc_ticks)
            VALUES ($id, $name, $model, $now, $now)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                model = excluded.model,
                updated_utc_ticks = excluded.updated_utc_ticks
            RETURNING created_utc_ticks;
            """;
        command.Parameters.AddWithValue("$id", dashboard.Id.ToString());
        command.Parameters.AddWithValue("$name", dashboard.Name.Trim());
        command.Parameters.AddWithValue("$model", dashboard.Model);
        command.Parameters.AddWithValue("$now", now.UtcTicks);
        var created = (long)(await command.ExecuteScalarAsync(cancellationToken))!;

        return dashboard with
        {
            Name = dashboard.Name.Trim(),
            CreatedAtUtc = new DateTimeOffset(created, TimeSpan.Zero),
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
        command.CommandText = "DELETE FROM report_dashboards WHERE id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
