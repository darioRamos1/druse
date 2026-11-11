using Druse.Platform.Abstractions;
using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Archivo local de BI, separado de druse.db: los resultados guardados pueden
/// pesar decenas de MiB y no deben inflar ni bloquear las conexiones y el
/// historial del usuario.
/// </summary>
internal static class ReportsDatabase
{
    public static string File(IAppPaths paths) => Path.Combine(paths.DataDirectory, "reports.db");

    public static async Task<SqliteConnection> OpenAsync(string databaseFile, CancellationToken cancellationToken)
    {
        var connection = await DruseDatabase.OpenConfiguredAsync(
            DruseDatabase.ConnectionString(databaseFile), databaseFile, cancellationToken);
        try
        {
            await using var command = connection.CreateCommand();
            command.CommandText = """
                CREATE TABLE IF NOT EXISTS report_snapshots (
                    dataset_id TEXT PRIMARY KEY,
                    definition_version INTEGER NOT NULL,
                    started_utc_ticks INTEGER NOT NULL,
                    completed_utc_ticks INTEGER NOT NULL,
                    payload_version INTEGER NOT NULL,
                    payload BLOB NOT NULL
                ) STRICT;

                CREATE TABLE IF NOT EXISTS report_datasets (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    format_version INTEGER NOT NULL,
                    definition TEXT NOT NULL,
                    created_utc_ticks INTEGER NOT NULL,
                    updated_utc_ticks INTEGER NOT NULL
                ) STRICT;
                """;
            await command.ExecuteNonQueryAsync(cancellationToken);
            return connection;
        }
        catch
        {
            await connection.DisposeAsync();
            throw;
        }
    }
}
