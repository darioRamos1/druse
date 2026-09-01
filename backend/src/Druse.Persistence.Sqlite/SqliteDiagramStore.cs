using System.Globalization;

using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Guarda los diagramas entidad-relación.
///
/// Uno a uno y por identificador, igual que los fragmentos de SQL. Lo que se
/// guarda son las decisiones de quien armó el diagrama —qué tablas entran, dónde
/// están, qué descartó—: **ni una columna ni un tipo del catálogo**, que se
/// releen al abrirlo.
/// </summary>
public sealed class SqliteDiagramStore(DruseDatabase database) : IDiagramStore
{
    private readonly DruseDatabase _database = database;

    public async Task<IReadOnlyList<SavedDiagram>> GetAllAsync(
        Guid connectionId,
        CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            SELECT id, connection_id, name, model, created_at_utc, updated_at_utc
            FROM diagrams
            WHERE connection_id = $connection
            ORDER BY updated_at_utc DESC
            """;

        command.Parameters.AddWithValue("$connection", connectionId.ToString());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var diagrams = new List<SavedDiagram>();

        while (await reader.ReadAsync(cancellationToken))
        {
            diagrams.Add(Read(reader));
        }

        return diagrams;
    }

    public async Task<SavedDiagram?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            SELECT id, connection_id, name, model, created_at_utc, updated_at_utc
            FROM diagrams
            WHERE id = $id
            """;

        command.Parameters.AddWithValue("$id", id.ToString());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        return await reader.ReadAsync(cancellationToken) ? Read(reader) : null;
    }

    public async Task SaveAsync(SavedDiagram diagram, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(diagram);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // La fecha de creación no se pisa al reemplazar: un diagrama que se
        // reordena sigue siendo el mismo.
        command.CommandText = """
            INSERT INTO diagrams (id, connection_id, name, model, created_at_utc, updated_at_utc)
            VALUES ($id, $connection, $name, $model, $created, $updated)
            ON CONFLICT (id) DO UPDATE SET
                name = excluded.name,
                model = excluded.model,
                updated_at_utc = excluded.updated_at_utc;
            """;

        var now = DateTimeOffset.UtcNow;

        command.Parameters.AddWithValue("$id", diagram.Id.ToString());
        command.Parameters.AddWithValue("$connection", diagram.ConnectionId.ToString());
        command.Parameters.AddWithValue("$name", diagram.Name);
        command.Parameters.AddWithValue("$model", diagram.Model);
        command.Parameters.AddWithValue(
            "$created",
            Format(diagram.CreatedAtUtc == default ? now : diagram.CreatedAtUtc));
        command.Parameters.AddWithValue(
            "$updated",
            Format(diagram.UpdatedAtUtc == default ? now : diagram.UpdatedAtUtc));

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = "DELETE FROM diagrams WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private static SavedDiagram Read(System.Data.Common.DbDataReader reader) => new()
    {
        Id = Guid.Parse(reader.GetString(0)),
        ConnectionId = Guid.Parse(reader.GetString(1)),
        Name = reader.GetString(2),
        Model = reader.GetString(3),
        CreatedAtUtc = ParseInstant(reader.GetString(4)),
        UpdatedAtUtc = ParseInstant(reader.GetString(5)),
    };

    private static string Format(DateTimeOffset instant) =>
        instant.ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset ParseInstant(string value) =>
        DateTimeOffset.Parse(value, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
}
