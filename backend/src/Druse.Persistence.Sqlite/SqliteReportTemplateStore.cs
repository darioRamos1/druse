using Druse.Application.Abstractions;
using Druse.Application.Reports;
using Druse.Platform.Abstractions;

namespace Druse.Persistence.Sqlite;

public sealed class SqliteReportTemplateStore(IAppPaths paths, TimeProvider clock) : IReportTemplateStore
{
    private readonly string _databaseFile = ReportsDatabase.File(paths);

    public async Task<IReadOnlyList<ReportTemplate>> GetAllAsync(CancellationToken cancellationToken)
    {
        if (!File.Exists(_databaseFile))
        {
            return [];
        }

        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            SELECT id, name, description, scope, model, created_utc_ticks, updated_utc_ticks
            FROM report_templates
            ORDER BY updated_utc_ticks DESC, name;
            """;
        await using var reader = await command.ExecuteReaderAsync(cancellationToken);
        var templates = new List<ReportTemplate>();
        while (await reader.ReadAsync(cancellationToken))
        {
            // Un ámbito que esta versión no conoce (de una versión más nueva) no
            // tumba la lista: esa plantilla simplemente no se ofrece.
            if (!Enum.TryParse<ReportTemplateScope>(reader.GetString(3), out var scope))
            {
                continue;
            }

            templates.Add(new ReportTemplate
            {
                Id = Guid.Parse(reader.GetString(0)),
                Name = reader.GetString(1),
                Description = reader.IsDBNull(2) ? null : reader.GetString(2),
                Scope = scope,
                Model = reader.GetString(4),
                CreatedAtUtc = new DateTimeOffset(reader.GetInt64(5), TimeSpan.Zero),
                UpdatedAtUtc = new DateTimeOffset(reader.GetInt64(6), TimeSpan.Zero),
            });
        }

        return templates;
    }

    public async Task<ReportTemplate> SaveAsync(ReportTemplate reportTemplate, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(reportTemplate);
        var template = reportTemplate;
        var now = clock.GetUtcNow();
        var description = string.IsNullOrWhiteSpace(template.Description) ? null : template.Description.Trim();
        await using var connection = await ReportsDatabase.OpenAsync(_databaseFile, cancellationToken);
        await using var command = connection.CreateCommand();
        command.CommandText = """
            INSERT INTO report_templates (id, name, description, scope, model, created_utc_ticks, updated_utc_ticks)
            VALUES ($id, $name, $description, $scope, $model, $now, $now)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                description = excluded.description,
                scope = excluded.scope,
                model = excluded.model,
                updated_utc_ticks = excluded.updated_utc_ticks
            RETURNING created_utc_ticks;
            """;
        command.Parameters.AddWithValue("$id", template.Id.ToString());
        command.Parameters.AddWithValue("$name", template.Name.Trim());
        command.Parameters.AddWithValue("$description", (object?)description ?? DBNull.Value);
        command.Parameters.AddWithValue("$scope", template.Scope.ToString());
        command.Parameters.AddWithValue("$model", template.Model);
        command.Parameters.AddWithValue("$now", now.UtcTicks);
        var created = (long)(await command.ExecuteScalarAsync(cancellationToken))!;

        return template with
        {
            Name = template.Name.Trim(),
            Description = description,
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
        command.CommandText = "DELETE FROM report_templates WHERE id = $id;";
        command.Parameters.AddWithValue("$id", id.ToString());
        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
