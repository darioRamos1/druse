using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.PostgreSql;

namespace Druse.ProviderContractTests;

/// <summary>
/// Conjunto contractual que todo proveedor debe superar (plan §11).
///
/// Cuando llegue SQL Server, estas mismas pruebas deben pasar contra él sin
/// cambiar lo que comprueban: si algo aquí resulta ser específico de PostgreSQL,
/// es señal de que se coló una fuga de dialecto en las abstracciones.
/// </summary>
public sealed class PostgreSqlProviderTests
{
    private static readonly PostgreSqlDatabaseProvider Provider = new();
    private static readonly PostgreSqlQueryExecutor Executor = new();
    private static readonly PostgreSqlMetadataReader Metadata = new();

    private static async Task<IDatabaseSession> OpenAsync(bool readOnly = false) =>
        await Provider.OpenSessionAsync(
            TestDatabase.Profile(readOnly),
            TestDatabase.Credentials,
            CancellationToken.None);

    private static QueryRequest Query(string sql, int maxRows = 500, int timeoutSeconds = 30) => new()
    {
        SessionId = Guid.NewGuid(),
        Sql = sql,
        MaxRows = maxRows,
        TimeoutSeconds = timeoutSeconds,
        DestructiveConfirmed = true,
    };

    // -----------------------------------------------------------------------
    // Conexión
    // -----------------------------------------------------------------------

    [RequiresPostgreSqlFact]
    public async Task ConexionValida_Funciona()
    {
        var result = await Provider.TestConnectionAsync(
            TestDatabase.Profile(),
            TestDatabase.Credentials,
            CancellationToken.None);

        Assert.True(result.Succeeded);
        Assert.False(string.IsNullOrWhiteSpace(result.ServerVersion));
    }

    [RequiresPostgreSqlFact]
    public async Task ConexionConCredencialesMalas_FallaSinRevelarLaContrasena()
    {
        const string WrongPassword = "contrasena-incorrecta-de-prueba";

        var result = await Provider.TestConnectionAsync(
            TestDatabase.Profile(),
            new DatabaseCredentials(WrongPassword),
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.NotNull(result.Error);

        // El error se muestra al usuario: no puede llevar la contraseña dentro
        // (plan §12).
        Assert.DoesNotContain(WrongPassword, result.Error.Message, StringComparison.Ordinal);
    }

    [RequiresPostgreSqlFact]
    public async Task ConexionAUnHostInexistente_FallaConMensajeUtil()
    {
        var profile = TestDatabase.Profile() with { Host = "host-que-no-existe.invalid" };

        var result = await Provider.TestConnectionAsync(
            profile,
            TestDatabase.Credentials,
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.NotNull(result.Error);
        Assert.False(string.IsNullOrWhiteSpace(result.Error.Message));
    }

    [RequiresPostgreSqlFact]
    public async Task AbrirYCerrarSesion()
    {
        var session = await OpenAsync();

        Assert.True(session.IsOpen);
        Assert.Equal(DatabaseEngine.PostgreSql, session.Engine);
        Assert.NotEqual(Guid.Empty, session.Id);

        await session.DisposeAsync();

        Assert.False(session.IsOpen);
    }

    // -----------------------------------------------------------------------
    // Consultas
    // -----------------------------------------------------------------------

    [RequiresPostgreSqlFact]
    public async Task SelectSimple_DevuelveColumnasYFilas()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT 1 AS numero, 'texto' AS palabra"),
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        var set = Assert.Single(result.ResultSets);
        Assert.Equal(2, set.Columns.Count);
        Assert.Equal("numero", set.Columns[0].Name);
        Assert.Equal(["1", "texto"], set.Rows[0]);
    }

    [RequiresPostgreSqlFact]
    public async Task SelectSinFilas_DevuelveColumnasIgualmente()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT 1 AS n WHERE false"),
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        var set = Assert.Single(result.ResultSets);
        Assert.Single(set.Columns);
        Assert.Empty(set.Rows);
    }

    [RequiresPostgreSqlFact]
    public async Task ValoresNulos_LleganComoNullYNoComoCadenaVacia()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT NULL::text AS vacio, '' AS cadena_vacia"),
            CancellationToken.None);

        var row = result.ResultSets[0].Rows[0];

        Assert.Null(row[0]);
        Assert.Equal(string.Empty, row[1]);
    }

    [RequiresPostgreSqlFact]
    public async Task TiposVariados_SeFormateanDeManeraPredecible()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("""
                SELECT
                    42::int8              AS entero,
                    3.5::numeric          AS decimalito,
                    true                  AS booleano,
                    DATE '2026-08-11'     AS fecha,
                    '\x4472757365'::bytea AS binario
                """),
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        var row = result.ResultSets[0].Rows[0];

        Assert.Equal("42", row[0]);
        // Cultura invariante: punto decimal, no la coma de la máquina.
        Assert.Equal("3.5", row[1]);
        Assert.Equal("true", row[2]);
        Assert.Equal("2026-08-11", row[3]);
        Assert.Equal(@"\x4472757365", row[4]);
    }

    [RequiresPostgreSqlFact]
    public async Task ErrorDeSintaxis_DevuelveEstadoFallidoConCodigo()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT * FROM"),
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Failed, result.State);
        Assert.NotNull(result.Error);
        // 42601 es el SQLSTATE estándar de error de sintaxis.
        Assert.Equal("42601", result.Error.Code);
    }

    [RequiresPostgreSqlFact]
    public async Task TablaInexistente_DevuelveErrorNormalizado()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT * FROM tabla_que_no_existe_jamas"),
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Failed, result.State);
        Assert.NotNull(result.Error);
        Assert.Equal("42P01", result.Error.Code);
    }

    [RequiresPostgreSqlFact]
    public async Task VariosConjuntosDeResultados()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT 1 AS a; SELECT 2 AS b; SELECT 3 AS c;"),
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        Assert.Equal(3, result.ResultSets.Count);
        Assert.Equal("a", result.ResultSets[0].Columns[0].Name);
        Assert.Equal("c", result.ResultSets[2].Columns[0].Name);
    }

    [RequiresPostgreSqlFact]
    public async Task LimiteDeFilas_RecortaYAvisa()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT generate_series(1, 1000) AS n", maxRows: 10),
            CancellationToken.None);

        var set = result.ResultSets[0];

        Assert.Equal(10, set.Rows.Count);
        // Recortar en silencio llevaría a sacar conclusiones equivocadas.
        Assert.True(set.Truncated);
    }

    [RequiresPostgreSqlFact]
    public async Task LimiteDeFilas_NoMarcaTruncadoSiCabeEntero()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT generate_series(1, 5) AS n", maxRows: 10),
            CancellationToken.None);

        Assert.Equal(5, result.ResultSets[0].Rows.Count);
        Assert.False(result.ResultSets[0].Truncated);
    }

    [RequiresPostgreSqlFact]
    public async Task Cancelacion_DetieneLaConsulta()
    {
        await using var session = await OpenAsync();

        using var cancellation = new CancellationTokenSource();
        cancellation.CancelAfter(TimeSpan.FromMilliseconds(300));

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT pg_sleep(30)", timeoutSeconds: 60),
            cancellation.Token);

        Assert.Equal(QueryExecutionState.Canceled, result.State);
        // Cancelar debe cortar de verdad, no esperar a que el servidor termine.
        Assert.True(result.Duration < TimeSpan.FromSeconds(10));
    }

    [RequiresPostgreSqlFact]
    public async Task Timeout_TerminaConError()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("SELECT pg_sleep(30)", timeoutSeconds: 1),
            CancellationToken.None);

        Assert.NotEqual(QueryExecutionState.Succeeded, result.State);
        Assert.True(result.Duration < TimeSpan.FromSeconds(15));
    }

    [RequiresPostgreSqlFact]
    public async Task InstruccionesQueEscriben_ReportanFilasAfectadas()
    {
        await using var session = await OpenAsync();

        var table = $"druse_tmp_{Guid.NewGuid():N}";

        try
        {
            await Executor.ExecuteAsync(
                session,
                Query($"CREATE TABLE {table} (id int)"),
                CancellationToken.None);

            var insert = await Executor.ExecuteAsync(
                session,
                Query($"INSERT INTO {table} (id) VALUES (1), (2), (3)"),
                CancellationToken.None);

            Assert.Equal(QueryExecutionState.Succeeded, insert.State);
            Assert.Equal(3, insert.RowsAffected);
            Assert.Empty(insert.ResultSets);
        }
        finally
        {
            await Executor.ExecuteAsync(
                session,
                Query($"DROP TABLE IF EXISTS {table}"),
                CancellationToken.None);
        }
    }

    [RequiresPostgreSqlFact]
    public async Task MensajesDelServidor_LleganAlResultado()
    {
        await using var session = await OpenAsync();

        var result = await Executor.ExecuteAsync(
            session,
            Query("DO $$ BEGIN RAISE NOTICE 'hola desde el servidor'; END $$;"),
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        Assert.Contains(result.Messages, message => message.Text.Contains("hola desde el servidor", StringComparison.Ordinal));
    }

    // -----------------------------------------------------------------------
    // Metadatos
    // -----------------------------------------------------------------------

    [RequiresPostgreSqlFact]
    public async Task ListaBasesDeDatos()
    {
        await using var session = await OpenAsync();

        var databases = await Metadata.GetDatabasesAsync(session, CancellationToken.None);

        Assert.NotEmpty(databases);
        Assert.All(databases, database => Assert.Equal(DatabaseObjectKind.Database, database.Kind));
        Assert.Contains(databases, database => database.Name == TestDatabase.Database);
    }

    [RequiresPostgreSqlFact]
    public async Task ListaEsquemasSinLosDelSistema()
    {
        await using var session = await OpenAsync();

        var database = new DatabaseObject
        {
            Id = $"db:{TestDatabase.Database}",
            Name = TestDatabase.Database,
            Kind = DatabaseObjectKind.Database,
            Database = TestDatabase.Database,
        };

        var schemas = await Metadata.GetChildrenAsync(session, database, CancellationToken.None);

        Assert.Contains(schemas, schema => schema.Name == "public");
        Assert.DoesNotContain(schemas, schema => schema.Name == "pg_catalog");
        Assert.DoesNotContain(schemas, schema => schema.Name == "information_schema");
    }

    [RequiresPostgreSqlFact]
    public async Task ElEsquemaOfreceLasCarpetasEsperadas()
    {
        await using var session = await OpenAsync();

        var schema = new DatabaseObject
        {
            Id = "schema:public",
            Name = "public",
            Kind = DatabaseObjectKind.Schema,
            Database = TestDatabase.Database,
            Schema = "public",
        };

        var folders = await Metadata.GetChildrenAsync(session, schema, CancellationToken.None);

        Assert.Equal(4, folders.Count);
        Assert.All(folders, folder => Assert.Equal(DatabaseObjectKind.Folder, folder.Kind));
        Assert.Contains(folders, folder => folder.Name == "Tables");
        Assert.Contains(folders, folder => folder.Name == "Views");
    }

    [RequiresPostgreSqlFact]
    public async Task ListaTablasYSusColumnas()
    {
        await using var session = await OpenAsync();

        var table = $"druse_tmp_{Guid.NewGuid():N}";

        try
        {
            await Executor.ExecuteAsync(
                session,
                Query($"""
                    CREATE TABLE {table} (
                        id        bigserial PRIMARY KEY,
                        nombre    text NOT NULL,
                        email     text,
                        creado_en timestamptz DEFAULT now()
                    )
                    """),
                CancellationToken.None);

            var folder = new DatabaseObject
            {
                Id = "folder:public:tables",
                Name = "Tables",
                Kind = DatabaseObjectKind.Folder,
                Database = TestDatabase.Database,
                Schema = "public",
            };

            var tables = await Metadata.GetChildrenAsync(session, folder, CancellationToken.None);
            var created = Assert.Single(tables, item => item.Name == table);

            Assert.Equal(DatabaseObjectKind.Table, created.Kind);

            var columns = await Metadata.GetColumnsAsync(session, created, CancellationToken.None);

            Assert.Equal(4, columns.Count);

            var id = columns[0];
            Assert.Equal("id", id.Name);
            Assert.True(id.IsPrimaryKey);
            Assert.False(id.IsNullable);

            var nombre = columns[1];
            Assert.False(nombre.IsNullable);

            var email = columns[2];
            Assert.True(email.IsNullable);
            Assert.False(email.IsPrimaryKey);

            var creado = columns[3];
            Assert.Equal("timestamp with time zone", creado.DataType);
            Assert.False(string.IsNullOrWhiteSpace(creado.DefaultValue));
        }
        finally
        {
            await Executor.ExecuteAsync(
                session,
                Query($"DROP TABLE IF EXISTS {table}"),
                CancellationToken.None);
        }
    }
}
