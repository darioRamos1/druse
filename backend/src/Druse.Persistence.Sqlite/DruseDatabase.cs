using Druse.Platform.Abstractions;
using Microsoft.Data.Sqlite;

namespace Druse.Persistence.Sqlite;

/// <summary>
/// Base local: apertura de conexiones y esquema.
///
/// SQLite guarda perfiles —de conexión y de respaldo—, historial, preferencias y
/// los fragmentos de SQL guardados.
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
    /// Se usa SQL explícito en lugar de migraciones de un ORM: son un puñado de
    /// tablas y el control sobre el archivo del usuario debe ser total.
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
                informix_server          TEXT    NOT NULL DEFAULT '',
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

        // Fragmentos de SQL guardados con nombre. Sin columna de conexión a
        // propósito: un fragmento vale para cualquiera, y atarlo a un perfil
        // obligaría a decidir qué hacer con él cuando ese perfil se borra.
        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS sql_snippets (
                id              TEXT NOT NULL PRIMARY KEY,
                name            TEXT NOT NULL,
                sql_text        TEXT NOT NULL,
                created_at_utc  TEXT NOT NULL,
                updated_at_utc  TEXT NOT NULL
            );
            """, cancellationToken);

        // La lista se abre por lo último que se tocó, que es lo que se busca.
        await ExecuteAsync(connection, """
            CREATE INDEX IF NOT EXISTS ix_sql_snippets_updated_at
                ON sql_snippets (updated_at_utc DESC);
            """, cancellationToken);

        // Proveedores de IA. **Sin columna para la clave**, y no por descuido: la
        // clave vive en el almacén del sistema, igual que las contraseñas de las
        // conexiones, y una columna aquí sería la puerta para que alguien la
        // metiera algún día en el archivo (plan §12).
        //
        // El modelo va como texto libre porque cada proveedor tiene los suyos y
        // aparecen más rápido de lo que se publica una versión de Druse.
        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS ai_providers (
                id              TEXT    NOT NULL PRIMARY KEY,
                name            TEXT    NOT NULL,
                kind            INTEGER NOT NULL DEFAULT 0,
                base_url        TEXT    NOT NULL DEFAULT '',
                model           TEXT    NOT NULL DEFAULT '',
                command         TEXT    NOT NULL DEFAULT '',
                own_session     INTEGER NOT NULL DEFAULT 0,
                disclosure      INTEGER NOT NULL DEFAULT 1,
                is_default      INTEGER NOT NULL DEFAULT 0,
                created_at_utc  TEXT    NOT NULL
            );
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

        // El servidor lógico de Informix. Vacío en todo lo que ya existía, que es
        // lo correcto: los perfiles anteriores son de DRDA, donde no se usa.
        await AddColumnIfMissingAsync(
            connection,
            "connection_profiles",
            "informix_server",
            "TEXT NOT NULL DEFAULT ''",
            cancellationToken);

        // La cuenta propia del asistente. Los archivos que ya tenían la tabla no
        // reciben la columna por `CREATE TABLE IF NOT EXISTS`, así que se añade
        // aparte; apagada, que es como se crearon: usando la sesión del equipo.
        await AddColumnIfMissingAsync(
            connection,
            "ai_providers",
            "own_session",
            "INTEGER NOT NULL DEFAULT 0",
            cancellationToken);

        // Diagramas entidad-relación guardados.
        //
        // **`model` no contiene ni una columna ni un tipo del catálogo**: lleva
        // qué tablas entran, dónde las puso el usuario y qué descartó. El
        // esquema se relee del motor cada vez que se abre el diagrama, que es lo
        // que evita que enseñe una columna borrada hace seis meses.
        //
        // Va como JSON y no repartido en tablas porque su forma la decide el
        // lienzo y cambiará con él; lo que la base necesita para listar y borrar
        // son las columnas de al lado.
        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS diagrams (
                id              TEXT NOT NULL PRIMARY KEY,
                connection_id   TEXT NOT NULL,
                name            TEXT NOT NULL,
                model           TEXT NOT NULL,
                created_at_utc  TEXT NOT NULL,
                updated_at_utc  TEXT NOT NULL
            );
            """, cancellationToken);

        // Se listan siempre por conexión y por lo último que se tocó.
        await ExecuteAsync(connection, """
            CREATE INDEX IF NOT EXISTS ix_diagrams_connection
                ON diagrams (connection_id, updated_at_utc DESC);
            """, cancellationToken);

        // Los trabajos largos que hubo: respaldos, restauraciones y traslados.
        //
        // **Se guarda para poder decir qué quedó a medias.** Un trabajo que
        // figure «en marcha» en un archivo recién abierto es uno que el cierre
        // anterior se llevó por delante, y lo que dejó escrito sigue donde esté.
        //
        // Solo qué era, sobre qué, cuándo y cómo acabó: ni credenciales, ni SQL,
        // ni filas. Esto lo puede abrir cualquiera con un visor de SQLite.
        await ExecuteAsync(connection, """
            CREATE TABLE IF NOT EXISTS jobs (
                id              TEXT NOT NULL PRIMARY KEY,
                kind            TEXT NOT NULL,
                subject         TEXT NULL,
                state           TEXT NOT NULL,
                outcome         TEXT NULL,
                started_at_utc  TEXT NOT NULL,
                finished_at_utc TEXT NULL
            );
            """, cancellationToken);

        // Se listan siempre por lo más reciente.
        await ExecuteAsync(connection, """
            CREATE INDEX IF NOT EXISTS ix_jobs_started
                ON jobs (started_at_utc DESC);
            """, cancellationToken);

        // En SQL Server, «exigir cifrado» valía además por verificar el
        // certificado: era el único modo que ponía `TrustServerCertificate` en
        // falso. Desde la 1.1.1, `Require` significa lo mismo en los cuatro
        // motores —cifra y no comprueba— y quien quiera comprobación pide
        // `VerifyFull`.
        //
        // Sin esta migración, un perfil de SQL Server guardado con `Require`
        // pasaría a **no verificar nada** y nadie se enteraría: una garantía que
        // desaparece en silencio al actualizar. Se mueve a `VerifyFull`, que es lo
        // que ese perfil ya estaba haciendo.
        //
        // Los números son los del enumerado —`DatabaseEngine.SqlServer` es 2,
        // `SslMode.Require` es 2 y `SslMode.VerifyFull` es 4— porque así se
        // guardan, y ninguno se reordena nunca por esta misma razón.
        await ExecuteAsync(connection, """
            UPDATE connection_profiles
            SET ssl_mode = 4
            WHERE engine = 2 AND ssl_mode = 2;
            """, cancellationToken);

        // Marca de versión del esquema, para poder migrar más adelante sin
        // adivinar en qué estado está el archivo de cada usuario.
        await ExecuteAsync(connection, "PRAGMA user_version = 9;", cancellationToken);
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
