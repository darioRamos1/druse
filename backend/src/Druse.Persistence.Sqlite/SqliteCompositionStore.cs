using System.Globalization;

using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Guarda las consultas del compositor, una a una y por identificador.
///
/// Se listan por tabla: el compositor se abre sobre una, y enseñar ahí lo que
/// se compuso para otra obligaría a filtrar a mano.
/// </summary>
public sealed class SqliteCompositionStore(DruseDatabase database) : ICompositionStore
{
    private readonly DruseDatabase _database = database;

    public async Task<IReadOnlyList<SavedComposition>> GetAllAsync(
        Guid connectionId,
        string database,
        string schema,
        string table,
        CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            SELECT id, connection_id, database_name, schema_name, table_name, name, model,
                   created_at_utc, updated_at_utc
            FROM query_compositions
            WHERE connection_id = $connection
              AND database_name = $database
              AND schema_name = $schema
              AND table_name = $table
            ORDER BY updated_at_utc DESC
            """;

        command.Parameters.AddWithValue("$connection", connectionId.ToString());
        command.Parameters.AddWithValue("$database", database);
        command.Parameters.AddWithValue("$schema", schema);
        command.Parameters.AddWithValue("$table", table);

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var compositions = new List<SavedComposition>();

        while (await reader.ReadAsync(cancellationToken))
        {
            compositions.Add(Read(reader));
        }

        return compositions;
    }

    public async Task SaveAsync(SavedComposition composition, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(composition);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // La tabla y la conexión no cambian al reemplazar: una composición
        // renombrada sigue siendo de la misma tabla.
        command.CommandText = """
            INSERT INTO query_compositions (
                id, connection_id, database_name, schema_name, table_name, name, model,
                created_at_utc, updated_at_utc)
            VALUES ($id, $connection, $database, $schema, $table, $name, $model, $created, $updated)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                model = excluded.model,
                updated_at_utc = excluded.updated_at_utc;
            """;

        var now = DateTimeOffset.UtcNow;

        command.Parameters.AddWithValue("$id", composition.Id.ToString());
        command.Parameters.AddWithValue("$connection", composition.ConnectionId.ToString());
        command.Parameters.AddWithValue("$database", composition.Database);
        command.Parameters.AddWithValue("$schema", composition.Schema);
        command.Parameters.AddWithValue("$table", composition.Table);
        command.Parameters.AddWithValue("$name", composition.Name);
        command.Parameters.AddWithValue("$model", composition.Model);
        command.Parameters.AddWithValue(
            "$created",
            Format(composition.CreatedAtUtc == default ? now : composition.CreatedAtUtc));
        command.Parameters.AddWithValue(
            "$updated",
            Format(composition.UpdatedAtUtc == default ? now : composition.UpdatedAtUtc));

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = "DELETE FROM query_compositions WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static SavedComposition Read(System.Data.Common.DbDataReader reader) => new()
    {
        Id = Guid.Parse(reader.GetString(0)),
        ConnectionId = Guid.Parse(reader.GetString(1)),
        Database = reader.GetString(2),
        Schema = reader.GetString(3),
        Table = reader.GetString(4),
        Name = reader.GetString(5),
        Model = reader.GetString(6),
        CreatedAtUtc = ParseInstant(reader.GetString(7)),
        UpdatedAtUtc = ParseInstant(reader.GetString(8)),
    };

    private static string Format(DateTimeOffset instant) =>
        instant.ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseInstant(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
