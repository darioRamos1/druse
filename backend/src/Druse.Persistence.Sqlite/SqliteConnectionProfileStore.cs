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
               environment, read_only, ssl_mode, connect_timeout_seconds,
               authentication, ssh_enabled, ssh_host, ssh_port, ssh_username,
               ssh_authentication, ssh_private_key_path, ssh_timeout_seconds
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
                authentication, environment, read_only, ssl_mode,
                connect_timeout_seconds, ssh_enabled, ssh_host, ssh_port,
                ssh_username, ssh_authentication, ssh_private_key_path,
                ssh_timeout_seconds, created_at_utc, updated_at_utc
            )
            VALUES (
                $id, $name, $engine, $host, $port, $database, $username,
                $authentication, $environment, $readOnly, $sslMode,
                $timeout, $sshEnabled, $sshHost, $sshPort,
                $sshUsername, $sshAuthentication, $sshPrivateKeyPath,
                $sshTimeout, $now, $now
            )
            ON CONFLICT (id) DO UPDATE SET
                name                    = excluded.name,
                engine                  = excluded.engine,
                host                    = excluded.host,
                port                    = excluded.port,
                database_name           = excluded.database_name,
                username                = excluded.username,
                authentication          = excluded.authentication,
                environment             = excluded.environment,
                read_only               = excluded.read_only,
                ssl_mode                = excluded.ssl_mode,
                connect_timeout_seconds = excluded.connect_timeout_seconds,
                ssh_enabled             = excluded.ssh_enabled,
                ssh_host                = excluded.ssh_host,
                ssh_port                = excluded.ssh_port,
                ssh_username            = excluded.ssh_username,
                ssh_authentication      = excluded.ssh_authentication,
                ssh_private_key_path    = excluded.ssh_private_key_path,
                ssh_timeout_seconds     = excluded.ssh_timeout_seconds,
                updated_at_utc          = excluded.updated_at_utc;
            """;

        command.Parameters.AddWithValue("$id", profile.Id.ToString());
        command.Parameters.AddWithValue("$name", profile.Name);
        command.Parameters.AddWithValue("$engine", (int)profile.Engine);
        command.Parameters.AddWithValue("$host", profile.Host);
        command.Parameters.AddWithValue("$port", profile.Port);
        command.Parameters.AddWithValue("$database", profile.Database);
        command.Parameters.AddWithValue("$username", profile.Username);
        command.Parameters.AddWithValue("$authentication", (int)profile.Authentication);
        command.Parameters.AddWithValue("$environment", (int)profile.Environment);
        command.Parameters.AddWithValue("$readOnly", profile.ReadOnly ? 1 : 0);
        command.Parameters.AddWithValue("$sslMode", (int)profile.SslMode);
        command.Parameters.AddWithValue("$timeout", profile.ConnectTimeoutSeconds);

        // Un perfil sin túnel guarda los valores por omisión en lugar de nulos:
        // así las columnas siguen siendo obligatorias y leerlas no obliga a
        // comprobar nulos en cada campo.
        var tunnel = profile.SshTunnel;

        command.Parameters.AddWithValue("$sshEnabled", tunnel is null ? 0 : 1);
        command.Parameters.AddWithValue("$sshHost", tunnel?.Host ?? string.Empty);
        command.Parameters.AddWithValue("$sshPort", tunnel?.Port ?? 22);
        command.Parameters.AddWithValue("$sshUsername", tunnel?.Username ?? string.Empty);
        command.Parameters.AddWithValue("$sshAuthentication", (int)(tunnel?.Authentication ?? SshAuthenticationMode.Password));
        command.Parameters.AddWithValue("$sshPrivateKeyPath", tunnel?.PrivateKeyPath ?? string.Empty);
        command.Parameters.AddWithValue("$sshTimeout", tunnel?.ConnectTimeoutSeconds ?? 15);
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

    /// <summary>El túnel solo existe si se marcó como activo al guardarlo.</summary>
    private static SshTunnelSettings? MapTunnel(DbDataReader reader) =>
        reader.GetInt32(12) == 0
            ? null
            : new SshTunnelSettings
            {
                Host = reader.GetString(13),
                Port = reader.GetInt32(14),
                Username = reader.GetString(15),
                Authentication = (SshAuthenticationMode)reader.GetInt32(16),
                PrivateKeyPath = reader.GetString(17),
                ConnectTimeoutSeconds = reader.GetInt32(18),
            };

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
        Authentication = (AuthenticationMode)reader.GetInt32(11),
        SshTunnel = MapTunnel(reader),
    };
}
