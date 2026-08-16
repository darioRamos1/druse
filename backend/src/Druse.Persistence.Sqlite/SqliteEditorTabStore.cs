using System.Globalization;

using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Guarda las pestañas del editor para poder devolverlas tras cerrar.
///
/// Se reemplazan todas de una vez, dentro de una transacción: si se guardara
/// pestaña a pestaña, un cierre a media escritura dejaría un conjunto que nunca
/// existió —unas pestañas de antes y otras de después— y al abrir se vería una
/// mezcla que el usuario no reconocería.
/// </summary>
public sealed class SqliteEditorTabStore(DruseDatabase database) : IEditorTabStore
{
    private readonly DruseDatabase _database = database;

    public async Task<IReadOnlyList<EditorTabState>> GetAllAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            SELECT id, position, title, sql_text, is_active, is_dirty,
                   connection_id, database_name, file_name, document_id, saved_at_utc
            FROM editor_tabs
            ORDER BY position
            """;

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var tabs = new List<EditorTabState>();

        while (await reader.ReadAsync(cancellationToken))
        {
            tabs.Add(new EditorTabState
            {
                Id = reader.GetString(0),
                Position = reader.GetInt32(1),
                Title = reader.GetString(2),
                Sql = reader.GetString(3),
                IsActive = reader.GetInt64(4) != 0,
                IsDirty = reader.GetInt64(5) != 0,
                ConnectionId = reader.IsDBNull(6) ? null : reader.GetString(6),
                Database = reader.IsDBNull(7) ? null : reader.GetString(7),
                FileName = reader.IsDBNull(8) ? null : reader.GetString(8),
                DocumentId = reader.IsDBNull(9) ? null : reader.GetString(9),
                SavedAtUtc = DateTimeOffset.Parse(
                    reader.GetString(10),
                    CultureInfo.InvariantCulture,
                    DateTimeStyles.RoundtripKind),
            });
        }

        return tabs;
    }

    public async Task ReplaceAllAsync(
        IReadOnlyList<EditorTabState> tabs,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(tabs);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        await using (var clear = connection.CreateCommand())
        {
            clear.CommandText = "DELETE FROM editor_tabs";
            await clear.ExecuteNonQueryAsync(cancellationToken);
        }

        for (var position = 0; position < tabs.Count; position++)
        {
            var tab = tabs[position];

            await using var insert = connection.CreateCommand();

            insert.CommandText = """
                INSERT INTO editor_tabs (
                    id, position, title, sql_text, is_active, is_dirty,
                    connection_id, database_name, file_name, document_id, saved_at_utc)
                VALUES (
                    $id, $position, $title, $sql, $active, $dirty,
                    $connection, $database, $file, $document, $saved);
                """;

            insert.Parameters.AddWithValue("$id", tab.Id);
            insert.Parameters.AddWithValue("$position", position);
            insert.Parameters.AddWithValue("$title", tab.Title);
            insert.Parameters.AddWithValue("$sql", tab.Sql);
            insert.Parameters.AddWithValue("$active", tab.IsActive ? 1 : 0);
            insert.Parameters.AddWithValue("$dirty", tab.IsDirty ? 1 : 0);
            insert.Parameters.AddWithValue("$connection", (object?)tab.ConnectionId ?? DBNull.Value);
            insert.Parameters.AddWithValue("$database", (object?)tab.Database ?? DBNull.Value);
            insert.Parameters.AddWithValue("$file", (object?)tab.FileName ?? DBNull.Value);
            insert.Parameters.AddWithValue("$document", (object?)tab.DocumentId ?? DBNull.Value);
            insert.Parameters.AddWithValue(
                "$saved",
                (tab.SavedAtUtc == default ? DateTimeOffset.UtcNow : tab.SavedAtUtc)
                    .ToString("O", CultureInfo.InvariantCulture));

            await insert.ExecuteNonQueryAsync(cancellationToken);
        }

        await transaction.CommitAsync(cancellationToken);
    }
}
