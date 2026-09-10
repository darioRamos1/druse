using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Oracle;

namespace Druse.ProviderContractTests;

/// <summary>
/// Conexión y dialecto de Oracle para el contrato común.
///
/// **Aquí «base» quiere decir esquema.** Una conexión de Oracle apunta a un
/// servicio y dentro no hay bases entre las que moverse: hay esquemas, que son
/// usuarios. El explorador los enseña en el sitio de las bases, así que
/// `DatabaseName` es un esquema y `Profile.Database` es el servicio: son dos
/// cosas distintas y por eso no coinciden, al revés que en los otros cuatro.
/// </summary>
public sealed class OracleFixture : IProviderFixture
{
    private static readonly Lazy<(bool Available, string? Reason)> Probed = new(Probe);

    public string EngineName => "Oracle";

    public bool IsAvailable => Probed.Value.Available;

    public string? UnavailableReason => Probed.Value.Reason;

    public IDatabaseProvider Provider { get; } = new OracleDatabaseProvider();

    public IQueryExecutor Executor { get; } = new OracleQueryExecutor();

    public IDatabaseMetadataReader Metadata { get; } = new OracleMetadataReader();

    public IRowEditor RowEditor { get; } = new OracleRowEditor();

    private readonly OracleTableDesigner _designer = new();

    public ITableDesigner Designer => _designer;

    public IDatabaseScripter Scripter => _designer;

    /// <summary>
    /// Faltan dos familias, y las dos son declaraciones.
    ///
    /// **No hay booleano** como tipo de columna antes de 23ai, así que no hay
    /// nada que probar bajo ese nombre; y **no hay hora sin fecha**: el `DATE` de
    /// Oracle siempre lleva las dos, y lo que representa un rato es un intervalo,
    /// que no es lo mismo.
    /// </summary>
    public IReadOnlyDictionary<ColumnFamily, string> TypesByFamily { get; } =
        new Dictionary<ColumnFamily, string>
        {
            [ColumnFamily.Text] = "VARCHAR2(100)",
            [ColumnFamily.Integral] = "NUMBER(10)",
            [ColumnFamily.Fractional] = "NUMBER(12,2)",
            [ColumnFamily.Date] = "DATE",
            [ColumnFamily.Timestamp] = "TIMESTAMP",
            [ColumnFamily.Binary] = "RAW(50)",
        };

    /// <summary>El esquema del usuario de pruebas, que es lo que el árbol enseña como base.</summary>
    public string DatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_ORACLE_SCHEMA") ?? "DRUSE";

    public string SecondaryDatabaseName =>
        Environment.GetEnvironmentVariable("DRUSE_TEST_ORACLE_SECOND_SCHEMA")
        ?? "DRUSE_SECUNDARIO";

    /// <summary>
    /// En Oracle el esquema **es** el usuario: el esquema por omisión es el del
    /// que conectó, no un `public` ni un `dbo`.
    /// </summary>
    public string DefaultSchema => DatabaseName;

    public string DefaultSchemaFor(string database) => database;

    public ConnectionProfile Profile(bool onlyRead = false) => new()
    {
        Id = Guid.NewGuid(),
        Name = "Oracle de pruebas",
        Engine = DatabaseEngine.Oracle,
        Host = Environment.GetEnvironmentVariable("DRUSE_TEST_ORACLE_HOST") ?? "127.0.0.1",
        Port = int.TryParse(Environment.GetEnvironmentVariable("DRUSE_TEST_ORACLE_PORT"), out var port)
            ? port
            : 15210,
        // El **servicio**, no el esquema: es lo que se nombra para conectar.
        Database = Environment.GetEnvironmentVariable("DRUSE_TEST_ORACLE_SERVICE") ?? "FREEPDB1",
        Username = Environment.GetEnvironmentVariable("DRUSE_TEST_ORACLE_USER") ?? "druse",
        ReadOnly = onlyRead,
        ConnectTimeoutSeconds = 10,
    };

    /// <summary>
    /// El mismo perfil: cambiar de esquema no cambia a dónde se conecta.
    ///
    /// Lo que cambia es `CURRENT_SCHEMA`, y de eso se encarga el proveedor en
    /// <c>OpenDatabaseSessionAsync</c>.
    /// </summary>
    public ConnectionProfile ProfileForDatabase(string database, bool onlyRead = false) =>
        Profile(onlyRead) with { Id = Guid.NewGuid() };

    public DatabaseCredentials Credentials =>
        new(Environment.GetEnvironmentVariable("DRUSE_TEST_ORACLE_PASSWORD") ?? "druse_dev_only");

    // --- Dialecto -----------------------------------------------------------

    /// <summary>
    /// Una consulta que tarda, **no un `SLEEP`**.
    ///
    /// `DBMS_SESSION.SLEEP` sería lo evidente, pero el aviso de cancelación que
    /// manda el driver no interrumpe una espera dentro de PL/SQL: el bloque
    /// duerme sus treinta segundos enteros y la prueba mide el tiempo de espera
    /// en vez de la cancelación. Una consulta de SQL sí atiende el corte, así que
    /// se hace trabajar al motor contando filas que no salen de ninguna tabla.
    ///
    /// Es el producto de dos series pequeñas y no una sola enorme: una serie de
    /// mil millones de filas no tarda, **revienta** con `ORA-30009` por falta de
    /// memoria, y entonces la prueba mide un error en vez de una cancelación.
    ///
    /// Las constantes están medidas en el contenedor de pruebas y no pretenden ser
    /// exactas: lo que importa es que dure bastante más de lo que la prueba espera.
    /// </summary>
    public string Sleep(int seconds) =>
        "SELECT COUNT(*) AS lento FROM " +
        $"(SELECT 1 FROM DUAL CONNECT BY LEVEL <= {seconds * 3_000}) a, " +
        $"(SELECT 1 FROM DUAL CONNECT BY LEVEL <= {seconds * 3_000}) b";

    /// <summary>
    /// La forma idiomática de Oracle para generar filas, y la más antigua: el
    /// `CONNECT BY` de las consultas jerárquicas aplicado a la tabla de una sola
    /// fila.
    /// </summary>
    public string GenerateRows(int count) =>
        $"SELECT LEVEL AS n FROM DUAL CONNECT BY LEVEL <= {count}";

    /// <summary>
    /// `DBMS_OUTPUT` es el equivalente al `RAISE NOTICE` de PostgreSQL, con una
    /// diferencia: el servidor no lo manda, lo guarda, y hay que ir a recogerlo.
    /// </summary>
    public string RaiseNotice(string text) =>
        $"BEGIN DBMS_OUTPUT.PUT_LINE('{text.Replace("'", "''", StringComparison.Ordinal)}'); END;";

    /// <summary>
    /// Oracle guarda en mayúsculas todo identificador que no vaya citado.
    ///
    /// Es la diferencia que más se nota al llegar de otro motor: una tabla creada
    /// como `clientes` se llama `CLIENTES`, y citarla en minúscula deja de
    /// encontrarla.
    /// </summary>
    public string Stored(string name) => name.ToUpperInvariant();

    /// <summary>
    /// Oracle no tiene tipo booleano como columna hasta 23ai, y la mayoría de las
    /// instalaciones no lo son: el valor verdadero se escribe como el uno que
    /// todo el mundo usa en su lugar.
    /// </summary>
    public bool TransportsBooleans => false;

    /// <summary>
    /// **`''` es `NULL`.** No hay forma de que este motor devuelva un texto de
    /// cero caracteres, así que la prueba de nulos comprueba otra cosa aquí.
    /// </summary>
    public bool HasEmptyStrings => false;

    public string SelectBasicTypes =>
        "SELECT 42 AS entero, 3.5 AS decimalito, 1 AS booleano, " +
        "DATE '2026-08-11' AS fecha FROM DUAL";

    public string SelectNullAndEmpty =>
        "SELECT CAST(NULL AS VARCHAR2(10)) AS nulo, '' AS cadena_vacia FROM DUAL";

    public string InvalidSyntax => "SELECT FROM WHERE";

    /// <summary>ORA-00936: falta una expresión.</summary>
    public string SyntaxErrorCode => "ORA-00936";

    /// <summary>
    /// No dice dónde.
    ///
    /// El servidor conoce el desplazamiento del error —SQL*Plus dibuja el
    /// asterisco debajo— pero ODP.NET no lo expone en ninguna propiedad de la
    /// excepción, así que el editor no tiene nada que señalar. Marcar una línea
    /// inventada sería peor que no marcar nada.
    /// </summary>
    public SyntaxErrorPlace SyntaxErrorPlace => SyntaxErrorPlace.Nothing;

    /// <summary>ORA-00942: la tabla o vista no existe.</summary>
    public string MissingTableCode => "ORA-00942";

    /// <summary>
    /// Oracle no encadena consultas con punto y coma: cada instrucción va sola.
    /// Varios resultados salen de un bloque que los devuelve **implícitamente**,
    /// que es lo que hay desde 12c y lo que usan sus propios clientes.
    /// </summary>
    public string ThreeResultSets => """
        DECLARE
          c1 SYS_REFCURSOR; c2 SYS_REFCURSOR; c3 SYS_REFCURSOR;
        BEGIN
          OPEN c1 FOR SELECT 1 AS a FROM DUAL; DBMS_SQL.RETURN_RESULT(c1);
          OPEN c2 FOR SELECT 2 AS b FROM DUAL; DBMS_SQL.RETURN_RESULT(c2);
          OPEN c3 FOR SELECT 3 AS c FROM DUAL; DBMS_SQL.RETURN_RESULT(c3);
        END;
        """;

    /// <summary>
    /// Los nombres van **sin citar**, como se escriben contra Oracle.
    ///
    /// Es lo mismo que hace el proveedor: solo cita lo que lo necesita, para que
    /// una tabla creada desde Druse se pueda leer luego desde SQL*Plus o desde
    /// cualquier informe. Ver `OracleIdentifier`. La consecuencia es que estas
    /// tablas se guardan en mayúsculas, igual que las de cualquier otra
    /// herramienta.
    /// </summary>
    public string CreateTable(string name) => $"CREATE TABLE {name} (id NUMBER)";

    /// <summary>
    /// Oracle no tiene `DROP … IF EXISTS` antes de 23ai.
    ///
    /// Lo que se hace desde siempre es intentarlo y tragarse el error, que es
    /// justo lo que estas pruebas quieren al limpiar: si la tabla no está, no hay
    /// nada que hacer, y el fallo de la limpieza taparía el de la prueba.
    /// </summary>
    public string DropTable(string name) => Silencioso($"DROP TABLE {name} PURGE");

    /// <summary>
    /// Oracle no encadena filas en un `VALUES`: para meter varias de una vez está
    /// `INSERT ALL`, que necesita un `SELECT` detrás aunque no lea nada.
    /// </summary>
    public string InsertThreeRows(string name) => $"""
        INSERT ALL
          INTO {name} (id) VALUES (1)
          INTO {name} (id) VALUES (2)
          INTO {name} (id) VALUES (3)
        SELECT * FROM DUAL
        """;

    public string InsertNamedRows(string name) => $"""
        INSERT ALL
          INTO {name} (id, nombre) VALUES (1, 'Ana')
          INTO {name} (id, nombre) VALUES (2, 'Bea')
          INTO {name} (id, nombre) VALUES (3, 'Cris')
        SELECT * FROM DUAL
        """;

    public string CreateTableWithColumns(string name) => $"""
        CREATE TABLE {name} (
            id        NUMBER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            nombre    VARCHAR2(200) NOT NULL,
            email     VARCHAR2(200) NULL,
            creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """;

    public string CreateView(string name) =>
        $"CREATE VIEW {name} AS SELECT 7 AS valor FROM DUAL";

    public string DropView(string name) => Silencioso($"DROP VIEW {name}");

    public string CreateProcedure(string name) => $"""
        CREATE OR REPLACE PROCEDURE {name} AS
        BEGIN
            DBMS_OUTPUT.PUT_LINE('marca_procedimiento');
        END;
        """;

    public string CreateProcedureWithParameters(string name) => $"""
        CREATE OR REPLACE PROCEDURE {name}(entrada IN NUMBER, salida OUT VARCHAR2) AS
        BEGIN
            salida := 'hecho';
        END;
        """;

    public string DropProcedure(string name) => Silencioso($"DROP PROCEDURE {name}");

    /// <summary>
    /// Oracle guarda la precisión dentro del nombre del tipo, así que una
    /// marca de tiempo se lee del catálogo con sus seis decimales puestos.
    /// </summary>
    public string TimestampTypeName => "TIMESTAMP(6)";

    /// <summary>
    /// La instrucción envuelta para que no falle si el objeto no está.
    ///
    /// Se atrapa cualquier error a propósito: los códigos cambian según lo que se
    /// esté borrando —`ORA-00942` una tabla, `ORA-04043` un procedimiento— y aquí
    /// lo único que importa es que después no exista.
    /// </summary>
    private static string Silencioso(string statement) => $"""
        BEGIN
          EXECUTE IMMEDIATE '{statement.Replace("'", "''", StringComparison.Ordinal)}';
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        """;

    private static (bool, string?) Probe()
    {
        try
        {
            var fixture = new OracleFixture();

            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));

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

/// <summary>Ejecuta el contrato común contra Oracle.</summary>
public sealed class OracleContractTests : DatabaseProviderContractTests<OracleFixture>;
