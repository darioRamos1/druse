using Druse.Platform.Abstractions;
using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Base local: apertura de conexiones y esquema.
///
/// SQLite guarda perfiles —de conexión y de respaldo—, historial y preferencias.
/// **Nunca contraseñas**: esas van al almacén del sistema operativo (plan §12).
/// </summary>
public sealed class DruseDatabase
{
    /// <summary>Columnas del túnel SSH, en el orden en que se añadieron.</summary>
    private static readonly (string Column, string Definition)[] SshColumns =
    [
        ("ssh_enabled", "INTEGER NOT NULL DEFAULT 0"),
        ("ssh_host", "TEXT NOT NULL DEFAULT ''"),
        ("ssh_port", "INTEGER NOT NULL DEFAULT 22"),
        ("ssh_username", "TEXT NOT NULL DEFAULT ''"),
        ("ssh_authentication", "INTEGER NOT NULL DEFAULT 0"),
        ("ssh_private_key_path", "TEXT NOT NULL DEFAULT ''"),
        ("ssh_timeout_seconds", "INTEGER NOT NULL DEFAULT 15"),
    ];

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
                authentication           INTEGER NOT NULL DEFAULT 0,
                environment              INTEGER NOT NULL DEFAULT 0,
                read_only                INTEGER NOT NULL DEFAULT 0,
                ssl_mode                 INTEGER NOT NULL DEFAULT 1,
                connect_timeout_seconds  INTEGER NOT NULL DEFAULT 15,
                ssh_enabled              INTEGER NOT NULL DEFAULT 0,
                ssh_host                 TEXT    NOT NULL DEFAULT '',
                ssh_port                 INTEGER NOT NULL DEFAULT 22,
                ssh_username             TEXT    NOT NULL DEFAULT '',
                ssh_authentication       INTEGER NOT NULL DEFAULT 0,
                ssh_private_key_path     TEXT    NOT NULL DEFAULT '',
                ssh_timeout_seconds      INTEGER NOT NULL DEFAULT 15,
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

        // Lo que el usuario llevaba escrito y no había ejecutado. El historial
        // guarda lo ejecutado; esto guarda lo demás, que es justo lo que se perdía
        // al cerrar.
        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS editor_tabs (
                id             TEXT    NOT NULL PRIMARY KEY,
                position       INTEGER NOT NULL,
                title          TEXT    NOT NULL,
                sql_text       TEXT    NOT NULL,
                is_active      INTEGER NOT NULL DEFAULT 0,
                is_dirty       INTEGER NOT NULL DEFAULT 0,
                connection_id  TEXT        NULL,
                database_name  TEXT        NULL,
                file_name      TEXT        NULL,
                document_id    TEXT        NULL,
                saved_at_utc   TEXT    NOT NULL
            );
            """, cancellationToken);

        // Respaldos guardados para repetirlos. La selección, las anulaciones y el
        // formato van como JSON porque son listas y diccionarios de tamaño libre
        // que solo se usan enteros; lo que se lista y se ordena —el nombre, la
        // conexión, las fechas— sí tiene columna propia.
        //
        // `connection_id` no es clave foránea a propósito: borrar una conexión no
        // puede llevarse por delante los perfiles hechos con ella, porque
        // describen la base y no el acceso.
        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS backup_profiles (
                id                 TEXT NOT NULL PRIMARY KEY,
                name               TEXT NOT NULL,
                connection_id      TEXT     NULL,
                database_name      TEXT     NULL,
                selection_json     TEXT NOT NULL DEFAULT '[]',
                data_json          TEXT NOT NULL DEFAULT '{}',
                output_json        TEXT NOT NULL DEFAULT '{}',
                destination        TEXT NOT NULL DEFAULT '',
                known_tables_json  TEXT NOT NULL DEFAULT '[]',
                created_at_utc     TEXT NOT NULL,
                updated_at_utc     TEXT NOT NULL,
                last_run_at_utc    TEXT     NULL
            );
            """, cancellationToken);

        // La lista se abre ordenada por lo último que se usó.
        await ExecuteAsync(connection, """
            CREATE INDEX IF NOT EXISTS ix_backup_profiles_last_run
                ON backup_profiles (last_run_at_utc DESC);
            """, cancellationToken);

        // Migraciones guardadas para repetirlas. Misma forma que los respaldos y
        // por lo mismo: la lista de tablas va como JSON porque solo se usa entera,
        // y lo que se lista y se ordena tiene columna propia.
        //
        // Los dos extremos se guardan **por su nombre** —conexión, base y
        // esquema—, nunca por identificador de sesión: un perfil se reabre meses
        // después, cuando aquella sesión hace mucho que se cerró.
        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS transfer_profiles (
                id                    TEXT NOT NULL PRIMARY KEY,
                name                  TEXT NOT NULL,
                source_connection_id  TEXT     NULL,
                source_database       TEXT     NULL,
                source_schema         TEXT     NULL,
                target_connection_id  TEXT     NULL,
                target_database       TEXT     NULL,
                target_schema         TEXT     NULL,
                tables_json           TEXT NOT NULL DEFAULT '[]',
                options_json          TEXT NOT NULL DEFAULT '{}',
                created_at_utc        TEXT NOT NULL,
                updated_at_utc        TEXT NOT NULL,
                last_run_at_utc       TEXT     NULL
            );
            """, cancellationToken);

        await ExecuteAsync(connection, """
            CREATE INDEX IF NOT EXISTS ix_transfer_profiles_last_run
                ON transfer_profiles (last_run_at_utc DESC);
            """, cancellationToken);

        // Los archivos creados por versiones anteriores ya tienen la tabla, así que
        // `CREATE TABLE IF NOT EXISTS` no les añade la columna: hay que agregarla
        // aparte. El valor por omisión deja los perfiles existentes con usuario y
        // contraseña, que es como se crearon.
        await AddColumnIfMissingAsync(
            connection,
            "connection_profiles",
            "authentication",
            "INTEGER NOT NULL DEFAULT 0",
            cancellationToken);

        // Túnel SSH. Los valores por omisión dejan a los perfiles existentes
        // conectando directamente, que es como se crearon.
        foreach (var (column, definition) in SshColumns)
        {
            await AddColumnIfMissingAsync(
                connection,
                "connection_profiles",
                column,
                definition,
                cancellationToken);
        }

        // Marca de versión del esquema, para poder migrar más adelante sin
        // adivinar en qué estado está el archivo de cada usuario.
        await ExecuteAsync(connection, "PRAGMA user_version = 4;", cancellationToken);
    }

    /// <summary>Añade una columna solo si el archivo del usuario aún no la tiene.</summary>
    private static async Task AddColumnIfMissingAsync(
        SqliteConnection connection,
        string table,
        string column,
        string definition,
        CancellationToken cancellationToken)
    {
        await using var query = connection.CreateCommand();
        // `PRAGMA table_info` no admite parámetros, de ahí la interpolación; el
        // nombre de la tabla lo pone esta clase, nunca el usuario.
        query.CommandText = $"SELECT 1 FROM pragma_table_info('{table}') WHERE name = $column";
        query.Parameters.AddWithValue("$column", column);

        if (await query.ExecuteScalarAsync(cancellationToken) is not null)
        {
            return;
        }

        await ExecuteAsync(
            connection,
            $"ALTER TABLE {table} ADD COLUMN {column} {definition};",
            cancellationToken);
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
