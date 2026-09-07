using System.Globalization;

using Druse.Application.Abstractions;

using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Los trabajos largos que hubo, en el archivo de siempre.
///
/// Existe para una sola pregunta, y solo se puede responder desde fuera del
/// proceso: **¿quedó algo a medias la última vez?** Los registros en memoria de
/// respaldos, restauraciones y traslados se van con Druse, que es justo el
/// momento en que la respuesta importa.
///
/// Se guarda lo mínimo para responderla —qué era, sobre qué, cuándo y cómo
/// acabó— y nada más: ni credenciales, ni SQL, ni filas. Un archivo local que
/// cualquiera puede abrir con un visor de SQLite no es sitio para eso.
/// </summary>
public sealed class SqliteJobStore(DruseDatabase database) : IJobStore
{
    /// <summary>Cuántos trabajos se conservan. Los más viejos se van solos.</summary>
    private const int Kept = 100;

    private readonly DruseDatabase _database = database;

    public async Task StartedAsync(JobRecord record, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(record);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            INSERT INTO jobs (id, kind, subject, state, outcome, started_at_utc, finished_at_utc)
            VALUES ($id, $kind, $subject, $state, NULL, $started, NULL)
            ON CONFLICT (id) DO UPDATE SET
                state = excluded.state,
                outcome = NULL,
                finished_at_utc = NULL
            """;

        command.Parameters.AddWithValue("$id", record.Id.ToString());
        command.Parameters.AddWithValue("$kind", record.Kind.ToString());
        command.Parameters.AddWithValue("$subject", (object?)record.Subject ?? DBNull.Value);
        command.Parameters.AddWithValue("$state", nameof(JobState.Running));
        command.Parameters.AddWithValue("$started", Text(record.StartedAtUtc));

        await command.ExecuteNonQueryAsync(cancellationToken);

        await TrimAsync(connection, cancellationToken);
    }

    public async Task FinishedAsync(Guid id, string outcome, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            UPDATE jobs
            SET state = $state, outcome = $outcome, finished_at_utc = $finished
            WHERE id = $id
            """;

        command.Parameters.AddWithValue("$id", id.ToString());
        command.Parameters.AddWithValue("$state", nameof(JobState.Finished));
        command.Parameters.AddWithValue("$outcome", outcome);
        command.Parameters.AddWithValue("$finished", Text(DateTimeOffset.UtcNow));

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<int> InterruptRunningAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // Sin `finished_at_utc`: no se sabe cuándo se fue al suelo, y poner la
        // hora de ahora diría que el trabajo duró hasta el arranque siguiente.
        command.CommandText = """
            UPDATE jobs
            SET state = $interrupted
            WHERE state = $running
            """;

        command.Parameters.AddWithValue("$interrupted", nameof(JobState.Interrupted));
        command.Parameters.AddWithValue("$running", nameof(JobState.Running));

        return await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<JobRecord>> RecentAsync(
        int limit,
        CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = """
            SELECT id, kind, subject, state, outcome, started_at_utc, finished_at_utc
            FROM jobs
            ORDER BY started_at_utc DESC
            LIMIT $limit
            """;

        command.Parameters.AddWithValue("$limit", Math.Max(1, limit));

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var jobs = new List<JobRecord>();

        while (await reader.ReadAsync(cancellationToken))
        {
            jobs.Add(new JobRecord
            {
                Id = Guid.Parse(reader.GetString(0), CultureInfo.InvariantCulture),
                Kind = Enum.Parse<JobKind>(reader.GetString(1)),
                Subject = reader.IsDBNull(2) ? null : reader.GetString(2),
                State = Enum.Parse<JobState>(reader.GetString(3)),
                Outcome = reader.IsDBNull(4) ? null : reader.GetString(4),
                StartedAtUtc = Moment(reader.GetString(5)),
                FinishedAtUtc = reader.IsDBNull(6) ? null : Moment(reader.GetString(6)),
            });
        }

        return jobs;
    }

    /// <summary>
    /// Deja solo los últimos, para que el archivo no crezca sin fin.
    ///
    /// Se recorta al empezar uno nuevo y no con una tarea aparte: es el único
    /// momento en que la tabla crece, y así no hay nada más que mantener vivo.
    /// </summary>
    private static async Task TrimAsync(
        SqliteConnection connection,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();

        command.CommandText = """
            DELETE FROM jobs
            WHERE id NOT IN (
                SELECT id FROM jobs ORDER BY started_at_utc DESC LIMIT $kept
            )
            """;

        command.Parameters.AddWithValue("$kept", Kept);

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    /// <summary>En ISO 8601 y en UTC, que es como se guarda todo lo demás aquí.</summary>
    private static string Text(DateTimeOffset moment) =>
        moment.UtcDateTime.ToString("O", CultureInfo.InvariantCulture);

    private static DateTimeOffset Moment(string text) =>
        DateTimeOffset.TryParse(
            text,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var moment)
            ? moment
            : DateTimeOffset.MinValue;
}
