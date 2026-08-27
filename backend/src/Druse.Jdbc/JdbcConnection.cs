using System.Data;
using System.Data.Common;
using System.Diagnostics.CodeAnalysis;

namespace Druse.Jdbc;

/// <summary>
/// Conexión ADO.NET servida por un driver JDBC.
///
/// La cadena de conexión que recibe **es una URL de JDBC**, no una cadena de
/// ADO.NET: quien la construye conoce el driver, y traducir de un formato a otro
/// aquí solo añadiría un sitio más donde equivocarse.
///
/// Ejemplo para Informix, que es lo que motivó esto:
/// <c>jdbc:informix-sqli://host:puerto/base:INFORMIXSERVER=nombre;user=u;password=p</c>
/// </summary>
public sealed class JdbcConnection : DbConnection
{
    private java.sql.Connection? _java;
    private string _connectionString = string.Empty;
    private string _database = string.Empty;
    private string _serverVersion = string.Empty;

    private static bool _informixRegistrado;

    /// <summary>
    /// Registra el driver de Informix en el `DriverManager`.
    ///
    /// En Java lo hace solo el mecanismo de servicios del jar al arrancar la
    /// máquina virtual. Bajo IKVM eso no ocurre, y sin ello `getConnection`
    /// responde «No suitable driver found» aunque el driver esté en el paquete
    /// —un mensaje que suena a URL mal escrita y manda a mirar donde no es—.
    ///
    /// Se registra **una instancia** en lugar de pedirlo por nombre con
    /// `Class.forName`: nombrar la clase no basta para que el ensamblado
    /// traducido llegue a cargarse, mientras que construirla lo garantiza.
    ///
    /// Que este método nombre a Informix no desentona: el driver de Informix es
    /// justamente lo que este proyecto empaqueta y su razón de existir.
    /// </summary>
    public static void RegisterInformixDriver()
    {
        lock (typeof(JdbcConnection))
        {
            if (_informixRegistrado)
            {
                return;
            }

            java.sql.DriverManager.registerDriver(new com.informix.jdbc.IfxDriver());
            _informixRegistrado = true;
        }
    }

    public JdbcConnection()
    {
    }

    public JdbcConnection(string connectionString) => ConnectionString = connectionString;

    /// <summary>La conexión de `java.sql`, para quien necesite bajar un piso.</summary>
    internal java.sql.Connection Java =>
        _java ?? throw new InvalidOperationException("La conexión no está abierta.");

    [AllowNull]
    public override string ConnectionString
    {
        get => _connectionString;
        set => _connectionString = value ?? string.Empty;
    }

    public override string Database => _database;

    public override string DataSource => DataSourceOf(_connectionString);

    public override string ServerVersion => _serverVersion;

    public override ConnectionState State =>
        _java is not null && !_java.isClosed() ? ConnectionState.Open : ConnectionState.Closed;

    public override void Open()
    {
        if (State == ConnectionState.Open)
        {
            return;
        }

        try
        {
            _java = java.sql.DriverManager.getConnection(_connectionString);

            var meta = _java.getMetaData();

            _serverVersion = meta.getDatabaseProductVersion() ?? string.Empty;
            _database = _java.getCatalog() ?? DatabaseOf(_connectionString);
        }
        catch (java.sql.SQLException exception)
        {
            // Envuelto para que arriba no haga falta conocer `java.sql`, y con el
            // estado SQL delante, que es lo que distingue «no existe la base» de
            // «la clave no vale».
            throw new JdbcException(exception);
        }
    }

    /// <summary>
    /// Abre la conexión sin dejar clavado al que espera.
    ///
    /// El trabajo se manda a otro hilo para que quien llamó pueda seguir
    /// atendiendo su token. **La conexión en curso no se aborta**: eso solo lo
    /// permite JDBC una vez hay un `Statement`, y aquí todavía no lo hay. Lo que
    /// se consigue es que la aplicación no se quede congelada esperando a un
    /// servidor que no contesta, no que el intento termine antes.
    ///
    /// El plazo real lo pone `Connect_Timeout` en la propia URL, que es quien
    /// puede cortarlo de verdad.
    /// </summary>
    public override Task OpenAsync(CancellationToken cancellationToken) =>
        JdbcCancellation.RunAsync<object?>(
            () =>
            {
                Open();
                return null;
            },
            // Nada que cancelar todavía: sin statement, JDBC no ofrece por dónde.
            () => { },
            cancellationToken);

    public override void Close()
    {
        if (_java is null)
        {
            return;
        }

        try
        {
            _java.close();
        }
        catch (java.sql.SQLException)
        {
            // Cerrar algo que ya se cayó no es un error que nadie pueda arreglar.
        }
        finally
        {
            _java = null;
        }
    }

    public override void ChangeDatabase(string databaseName) =>
        throw new NotSupportedException(
            "En Informix una conexión pertenece a una base y no se cambia: hay que abrir otra.");

    protected override DbCommand CreateDbCommand() => new JdbcCommand { Connection = this };

    protected override DbTransaction BeginDbTransaction(IsolationLevel isolationLevel)
    {
        var java = Java;

        java.setAutoCommit(false);

        if (isolationLevel != IsolationLevel.Unspecified)
        {
            java.setTransactionIsolation(Translate(isolationLevel));
        }

        return new JdbcTransaction(this, isolationLevel);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Close();
        }

        base.Dispose(disposing);
    }

    /// <summary>
    /// Niveles de aislamiento de JDBC.
    ///
    /// Escritos aquí y no leídos de `java.sql.Connection` porque son constantes
    /// de una interfaz Java, que no se alcanzan igual desde C#. Los fija la
    /// especificación de JDBC y no han cambiado nunca.
    /// </summary>
    private const int TransactionReadUncommitted = 1;
    private const int TransactionReadCommitted = 2;
    private const int TransactionRepeatableRead = 4;
    private const int TransactionSerializable = 8;

    private static int Translate(IsolationLevel level) => level switch
    {
        IsolationLevel.ReadUncommitted => TransactionReadUncommitted,
        IsolationLevel.RepeatableRead => TransactionRepeatableRead,
        IsolationLevel.Serializable => TransactionSerializable,
        _ => TransactionReadCommitted,
    };

    /// <summary>El `host:puerto` de la URL, para poder nombrarlo en los mensajes.</summary>
    private static string DataSourceOf(string url)
    {
        var inicio = url.IndexOf("//", StringComparison.Ordinal);

        if (inicio < 0)
        {
            return string.Empty;
        }

        var resto = url[(inicio + 2)..];
        var fin = resto.IndexOf('/');

        return fin < 0 ? resto : resto[..fin];
    }

    /// <summary>
    /// La base que nombra la URL.
    ///
    /// Solo se usa cuando el driver no la dice: en Informix el catálogo viene
    /// vacío, y dejar el nombre en blanco confundiría a quien lo enseñe.
    /// </summary>
    private static string DatabaseOf(string url)
    {
        var inicio = url.IndexOf("//", StringComparison.Ordinal);

        if (inicio < 0)
        {
            return string.Empty;
        }

        var resto = url[(inicio + 2)..];
        var barra = resto.IndexOf('/');

        if (barra < 0)
        {
            return string.Empty;
        }

        var cola = resto[(barra + 1)..];
        var corte = cola.IndexOfAny([':', ';', '?']);

        return corte < 0 ? cola : cola[..corte];
    }
}

/// <summary>
/// Un error del driver, con su estado SQL y su código.
///
/// Hereda de <see cref="DbException"/> para que el resto del sistema lo trate
/// como cualquier otro error de base de datos.
/// </summary>
public sealed class JdbcException : DbException
{
    internal JdbcException(java.sql.SQLException inner)
        : base(inner.getMessage() ?? "Error del driver JDBC.", inner)
    {
        SqlStateValue = inner.getSQLState() ?? string.Empty;
        ErrorCode = inner.getErrorCode();
    }

    /// <summary>SQLSTATE de cinco caracteres, o vacío si el driver no lo dio.</summary>
    public string SqlStateValue { get; }

    /// <summary>Código propio del motor.</summary>
    public new int ErrorCode { get; }
}
