using System.Data.Common;
using System.Globalization;
using Druse.Application.Abstractions;
using Druse.Domain;
using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Perfiles guardados en la base local.
///
/// La tabla no tiene columna de contraseña, y no puede tenerla mientras
/// `ConnectionProfile` no la exponga.
/// </summary>
public sealed class SqliteConnectionProfileStore(DruseDatabase database) : IConnectionProfileStore
{
    private const string SelectColumns = """
        SELECT id, name, engine, host, port, database_name, username,
               environment, read_only, ssl_mode, connect_timeout_seconds
        FROM connection_profiles
        """;

    private readonly DruseDatabase _database = database;

    public async Task<IReadOnlyList<ConnectionProfile>> GetAllAsync(CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = $"{SelectColumns} ORDER BY name COLLATE NOCASE";

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        var profiles = new List<ConnectionProfile>();

        while (await reader.ReadAsync(cancellationToken))
        {
            profiles.Add(Map(reader));
        }

        return profiles;
    }

    public async Task<ConnectionProfile?> FindAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = $"{SelectColumns} WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        await using var reader = await command.ExecuteReaderAsync(cancellationToken);

        return await reader.ReadAsync(cancellationToken) ? Map(reader) : null;
    }

    public async Task SaveAsync(ConnectionProfile profile, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(profile);

        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        // `ON CONFLICT` conserva la fecha de creación original al actualizar.
        command.CommandText = """
            INSERT INTO connection_profiles (
                id, name, engine, host, port, database_name, username,
                environment, read_only, ssl_mode, connect_timeout_seconds,
                created_at_utc, updated_at_utc
            )
            VALUES (
                $id, $name, $engine, $host, $port, $database, $username,
                $environment, $readOnly, $sslMode, $timeout,
                $now, $now
            )
            ON CONFLICT (id) DO UPDATE SET
                name                    = excluded.name,
                engine                  = excluded.engine,
                host                    = excluded.host,
                port                    = excluded.port,
                database_name           = excluded.database_name,
                username                = excluded.username,
                environment             = excluded.environment,
                read_only               = excluded.read_only,
                ssl_mode                = excluded.ssl_mode,
                connect_timeout_seconds = excluded.connect_timeout_seconds,
                updated_at_utc          = excluded.updated_at_utc;
            """;

        command.Parameters.AddWithValue("$id", profile.Id.ToString());
        command.Parameters.AddWithValue("$name", profile.Name);
        command.Parameters.AddWithValue("$engine", (int)profile.Engine);
        command.Parameters.AddWithValue("$host", profile.Host);
        command.Parameters.AddWithValue("$port", profile.Port);
        command.Parameters.AddWithValue("$database", profile.Database);
        command.Parameters.AddWithValue("$username", profile.Username);
        command.Parameters.AddWithValue("$environment", (int)profile.Environment);
        command.Parameters.AddWithValue("$readOnly", profile.ReadOnly ? 1 : 0);
        command.Parameters.AddWithValue("$sslMode", (int)profile.SslMode);
        command.Parameters.AddWithValue("$timeout", profile.ConnectTimeoutSeconds);
        command.Parameters.AddWithValue("$now", DateTimeOffset.UtcNow.ToString("O", CultureInfo.InvariantCulture));

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    public async Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken)
    {
        await using var connection = await _database.OpenAsync(cancellationToken);
        await using var command = connection.CreateCommand();

        command.CommandText = "DELETE FROM connection_profiles WHERE id = $id";
        command.Parameters.AddWithValue("$id", id.ToString());

        return await command.ExecuteNonQueryAsync(cancellationToken) > 0;
    }

    private static ConnectionProfile Map(DbDataReader reader) => new()
    {
        Id = Guid.Parse(reader.GetString(0)),
        Name = reader.GetString(1),
        Engine = (DatabaseEngine)reader.GetInt32(2),
        Host = reader.GetString(3),
        Port = reader.GetInt32(4),
        Database = reader.GetString(5),
        Username = reader.GetString(6),
        Environment = (ConnectionEnvironment)reader.GetInt32(7),
        ReadOnly = reader.GetInt32(8) != 0,
        SslMode = (SslMode)reader.GetInt32(9),
        ConnectTimeoutSeconds = reader.GetInt32(10),
    };
}
