using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Informix;

namespace Druse.ProviderContractTests;

/// <summary>Conexión y dialecto de Informix para el contrato común.</summary>
public sealed class InformixFixture : IProviderFixture
{
    private static readonly Lazy<(bool Available, string? Reason)> Probed = new(Probe);

    public string EngineName => "Informix";

    public bool IsAvailable => Probed.Value.Available;

    public string? UnavailableReason => Probed.Value.Reason;

    public IDatabaseProvider Provider { get; } = new InformixDatabaseProvider();

    public IQueryExecutor Executor { get; } = new InformixQueryExecutor();

    public IDatabaseMetadataReader Metadata { get; } = new InformixMetadataReader();

    public IRowEditor RowEditor { get; } = new InformixRowEditor();

    public ITableDesigner Designer { get; } = new InformixTableDesigner();

    public string DatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_DB") ?? "druse_test";

    public string SecondaryDatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_SECOND_DB") ?? "druse_test2";

    /// <summary>
    /// En Informix el «esquema» es el propietario de la tabla, no un objeto que se
    /// cree aparte. El esquema por omisión es por tanto el usuario conectado.
    /// </summary>
    public string DefaultSchema =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_USER") ?? "informix";

    public string DefaultSchemaFor(string database) => DefaultSchema;

    public ConnectionProfile Profile(bool onlyRead = false) => new()
    {
        Id = Guid.NewGuid(),
        Name = "Informix de pruebas",
        Engine = DatabaseEngine.Informix,
        Host = Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_HOST") ?? "127.0.0.1",
        // El puerto es el del escuchador DRDA, no el nativo: Druse se conecta por
        // DRDA con el proveedor de IBM.
        Port = int.TryParse(Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_PORT"), out var port)
            ? port
            : 9089,
        Database = DatabaseName,
        Username = Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_USER") ?? "informix",
        ReadOnly = onlyRead,
        ConnectTimeoutSeconds = 5,
    };

    public ConnectionProfile ProfileForDatabase(string database, bool onlyRead = false) =>
        Profile(onlyRead) with { Id = Guid.NewGuid(), Database = database };

    public DatabaseCredentials Credentials =>
        new(Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_PASSWORD") ?? "in4mix");

    // --- Dialecto -----------------------------------------------------------

    /// <summary>
    /// Informix no tiene función de espera.
    ///
    /// Ni `pg_sleep`, ni `WAITFOR`, ni `SLEEP`. La única forma sin escribir un
    /// procedimiento es hacer trabajar al servidor: un producto cartesiano sobre
    /// `systables` tarda lo suficiente para poder cancelarlo. **No es una espera
    /// exacta**: el tiempo depende de la máquina, así que las comprobaciones que
    /// dependan de una duración concreta serán menos precisas aquí que en los
    /// otros motores.
    /// </summary>
    public string Sleep(int seconds) => $"""
        SELECT COUNT(*)
        FROM systables a, systables b, systables c
        WHERE a.tabid > 0 AND b.tabid > 0 AND c.tabid > {seconds - seconds}
        """;

    /// <summary>
    /// Informix no admite CTE recursivas como PostgreSQL o MySQL. La forma
    /// idiomática de generar filas es la tabla virtual `sysmaster:sysdual` o un
    /// recorrido sobre el catálogo, limitado con `FIRST`.
    /// </summary>
    public string GenerateRows(int count) => $"""
        SELECT FIRST {count} ROWNUMBER AS n
        FROM systables a, systables b
        """;

    /// <summary>
    /// Informix no tiene `PRINT` ni `RAISE NOTICE` fuera de un procedimiento.
    /// El equivalente más cercano en SQL suelto es una sentencia que el servidor
    /// acepta sin producir nada, así que **este motor no ejercita los avisos**:
    /// se devuelve una consulta inocua para que el contrato no falle por algo que
    /// el motor no ofrece.
    /// </summary>
    public string RaiseNotice(string text) => $"SELECT '{text}' AS aviso FROM sysmaster:sysdual";

    /// <summary>
    /// Informix sí tiene `BOOLEAN`, pero fuera de una tabla no hay forma de
    /// producirlo con un literal, así que se declara una tabla temporal como en
    /// MySQL.
    /// </summary>
    public string SelectBasicTypes => """
        SELECT
            42::BIGINT AS entero,
            3.5::DECIMAL(10,1) AS decimalito,
            't'::BOOLEAN AS booleano,
            '2026-08-11'::DATE AS fecha
        FROM sysmaster:sysdual
        """;

    public string SelectNullAndEmpty => """
        SELECT NULL::VARCHAR(10) AS vacio, '' AS cadena_vacia FROM sysmaster:sysdual
        """;

    public string InvalidSyntax => "SELECT * FROM";

    /// <summary>-201: error de sintaxis. Informix numera sus errores en negativo.</summary>
    public string SyntaxErrorCode => "-201";

    /// <summary>-206: la tabla no está en la base de datos.</summary>
    public string MissingTableCode => "-206";

    public string ThreeResultSets => "SELECT 1 AS a; SELECT 2 AS b; SELECT 3 AS c;";

    public string CreateTable(string name) => $"CREATE TABLE {name} (id INTEGER)";

    /// <summary>Informix no admite `IF EXISTS` al borrar en versiones antiguas.</summary>
    public string DropTable(string name) => $"DROP TABLE IF EXISTS {name}";

    public string InsertThreeRows(string name) => $"""
        INSERT INTO {name} (id) VALUES (1);
        INSERT INTO {name} (id) VALUES (2);
        INSERT INTO {name} (id) VALUES (3);
        """;

    public string InsertNamedRows(string name) => $"""
        INSERT INTO {name} (id, nombre) VALUES (1, 'Ana');
        INSERT INTO {name} (id, nombre) VALUES (2, 'Bea');
        INSERT INTO {name} (id, nombre) VALUES (3, 'Cris');
        """;

    /// <summary>
    /// `BIGSERIAL` es la identidad de Informix: el tipo **es** la identidad, no
    /// una cláusula que se añade detrás como en los otros tres motores.
    /// </summary>
    public string CreateTableWithColumns(string name) => $"""
        CREATE TABLE {name} (
            id        BIGSERIAL PRIMARY KEY,
            nombre    VARCHAR(200) NOT NULL,
            email     VARCHAR(200),
            creado_en DATETIME YEAR TO SECOND DEFAULT CURRENT YEAR TO SECOND
        )
        """;

    public string CreateView(string name) =>
        $"CREATE VIEW {name} AS SELECT 7 AS valor FROM sysmaster:sysdual";

    public string DropView(string name) => $"DROP VIEW IF EXISTS {name}";

    /// <summary>
    /// Informix escribe procedimientos en SPL, con `DEFINE` y `RETURN` en lugar
    /// del `BEGIN … END` de los otros motores.
    /// </summary>
    public string CreateProcedure(string name) => $"""
        CREATE PROCEDURE {name}() RETURNING VARCHAR(30);
            RETURN 'marca_procedimiento';
        END PROCEDURE
        """;

    public string DropProcedure(string name) => $"DROP PROCEDURE IF EXISTS {name}";

    /// <summary>
    /// Informix no tiene un tipo con semántica de zona horaria como `timestamptz`
    /// o `TIMESTAMP`: `DATETIME` guarda la hora tal cual se escribió.
    /// </summary>
    public string TimestampTypeName => "DATETIME";

    private static (bool, string?) Probe()
    {
        try
        {
            var fixture = new InformixFixture();

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(20));

            var result = fixture.Provider
                .TestConnectionAsync(fixture.Profile(), fixture.Credentials, timeout.Token)
                .GetAwaiter()
                .GetResult();

            return (result.Succeeded, result.Error?.Message);
        }
        catch (Exception exception)
        {
            return (false, exception.Message);
        }
    }
}

/// <summary>Ejecuta el contrato común contra Informix.</summary>
public sealed class InformixContractTests : DatabaseProviderContractTests<InformixFixture>;
