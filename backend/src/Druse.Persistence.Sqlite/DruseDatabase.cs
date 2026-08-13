using Druse.Platform.Abstractions;
using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Base local: apertura de conexiones y esquema.
///
/// SQLite guarda perfiles, historial y preferencias. **Nunca contraseñas**: esas
/// van al almacén del sistema operativo (plan §12).
/// </summary>
public sealed class DruseDatabase
{
    private readonly IAppPaths _paths;
    private readonly string _connectionString;

    public DruseDatabase(IAppPaths paths)
    {
        ArgumentNullException.ThrowIfNull(paths);

        _paths = paths;
        _connectionString = new SqliteConnectionStringBuilder
        {
            DataSource = paths.DatabaseFile,
            Mode = SqliteOpenMode.ReadWriteCreate,
            // Varias peticiones HTTP pueden escribir a la vez; sin este modo,
            // SQLite devolvería «database is locked» en cuanto coincidieran.
            Cache = SqliteCacheMode.Shared,
        }.ConnectionString;
    }

    /// <summary>Abre una conexión ya configurada.</summary>
    public async Task<SqliteConnection> OpenAsync(CancellationToken cancellationToken)
    {
        var connection = new SqliteConnection(_connectionString);

        await connection.OpenAsync(cancellationToken);

        // WAL permite leer mientras otro escribe, que es justo lo que hace el
        // historial mientras el usuario consulta sus conexiones.
        await ExecuteAsync(connection, "PRAGMA journal_mode = WAL;", cancellationToken);
        await ExecuteAsync(connection, "PRAGMA foreign_keys = ON;", cancellationToken);
        await ExecuteAsync(connection, "PRAGMA busy_timeout = 5000;", cancellationToken);

        return connection;
    }

    /// <summary>
    /// Crea el esquema si falta.
    ///
    /// Se usa SQL explícito en lugar de migraciones de un ORM: son cuatro tablas
    /// y el control sobre el archivo del usuario debe ser total.
    /// </summary>
    public async Task MigrateAsync(CancellationToken cancellationToken)
    {
        _paths.EnsureCreated();

        await using var connection = await OpenAsync(cancellationToken);

        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS connection_profiles (
                id                       TEXT    NOT NULL PRIMARY KEY,
                name                     TEXT    NOT NULL,
                engine                   INTEGER NOT NULL,
                host                     TEXT    NOT NULL,
                port                     INTEGER NOT NULL,
                database_name            TEXT    NOT NULL,
                username                 TEXT    NOT NULL,
                environment              INTEGER NOT NULL DEFAULT 0,
                read_only                INTEGER NOT NULL DEFAULT 0,
                ssl_mode                 INTEGER NOT NULL DEFAULT 1,
                connect_timeout_seconds  INTEGER NOT NULL DEFAULT 15,
                created_at_utc           TEXT    NOT NULL,
                updated_at_utc           TEXT    NOT NULL
            );
            """, cancellationToken);

        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS query_history (
                id               TEXT    NOT NULL PRIMARY KEY,
                connection_id    TEXT        NULL,
                connection_name  TEXT    NOT NULL,
                database_name    TEXT    NOT NULL,
                sql_text         TEXT    NOT NULL,
                executed_at_utc  TEXT    NOT NULL,
                duration_ms      INTEGER NOT NULL,
                succeeded        INTEGER NOT NULL,
                row_count        INTEGER     NULL,
                error_message    TEXT        NULL
            );
            """, cancellationToken);

        // El historial se consulta siempre por fecha descendente.
        await ExecuteAsync(connection, """
            CREATE INDEX IF NOT EXISTS ix_query_history_executed_at
                ON query_history (executed_at_utc DESC);
            """, cancellationToken);

        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS preferences (
                key   TEXT NOT NULL PRIMARY KEY,
                value TEXT NOT NULL
            );
            """, cancellationToken);

        // Marca de versión del esquema, para poder migrar más adelante sin
        // adivinar en qué estado está el archivo de cada usuario.
        await ExecuteAsync(connection, "PRAGMA user_version = 1;", cancellationToken);
    }

    private static async Task ExecuteAsync(
        SqliteConnection connection,
        string sql,
        CancellationToken cancellationToken)
    {
        await using var command = connection.CreateCommand();
        command.CommandText = sql;

        await command.ExecuteNonQueryAsync(cancellationToken);
    }
}
