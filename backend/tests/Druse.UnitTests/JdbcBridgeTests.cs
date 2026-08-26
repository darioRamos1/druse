using System.Data;
using Druse.Jdbc;

namespace Druse.UnitTests;

/// <summary>
/// El puente ADO.NET sobre JDBC, contra un Informix de verdad.
///
/// Es lo único de Druse que habla **SQLI**, el protocolo nativo de Informix, y
/// por tanto lo único que llega a servidores sin escuchador DRDA. Como todo lo
/// que traduce entre dos mundos, lo que falla aquí no son los casos raros sino
/// los desajustes tontos —índices que empiezan en 1, nulos que hay que preguntar
/// después de leer—, así que las pruebas van justo a eso.
/// </summary>
public sealed class JdbcBridgeTests
{
    private static string Url()
    {
        var puerto = Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_SQLI_PORT") ?? "9088";
        var servidor = Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_SERVER") ?? "informix";

        return $"jdbc:informix-sqli://127.0.0.1:{puerto}/sysmaster:INFORMIXSERVER={servidor};"
            + "user=informix;password=in4mix";
    }

    private static JdbcConnection Abrir()
    {
        // Sin esto, `getConnection` responde «No suitable driver found» aunque el
        // driver esté ahí: bajo IKVM nadie lo registra solo.
        JdbcConnection.RegisterInformixDriver();

        var conexion = new JdbcConnection(Url());

        conexion.Open();

        return conexion;
    }

    [RequiresInformixSqliFact]
    public void AbreYDiceQueVersionHayAlOtroLado()
    {
        using var conexion = Abrir();

        Assert.Equal(ConnectionState.Open, conexion.State);

        // El driver da el número desnudo —«15.0.1.0.3DE»—, sin el nombre del
        // producto delante. Lo que importa es que venga algo con forma de
        // versión: es lo que se enseña al probar la conexión.
        Assert.False(string.IsNullOrWhiteSpace(conexion.ServerVersion));
        Assert.Contains(".", conexion.ServerVersion, StringComparison.Ordinal);
    }

    [RequiresInformixSqliFact]
    public void LeeColumnasPorNombreYPorPosicion()
    {
        using var conexion = Abrir();
        using var comando = conexion.CreateCommand();

        comando.CommandText = "SELECT FIRST 1 1 AS uno, 'dos' AS texto FROM systables";

        using var lector = comando.ExecuteReader();

        Assert.True(lector.Read());
        Assert.Equal(2, lector.FieldCount);

        // Por posición y por nombre dan lo mismo: es el desajuste de índices que
        // rompe estos puentes.
        Assert.Equal(1, lector.GetInt32(0));
        Assert.Equal("dos", lector.GetString(1));
        Assert.Equal("dos", lector["texto"]);
        Assert.Equal("uno", lector.GetName(0));
    }

    /// <summary>
    /// Un nulo se reconoce como tal.
    ///
    /// En JDBC no basta con mirar el valor: hay que preguntar `wasNull()`
    /// **después** de leerlo, porque un entero nulo vuelve como cero. Sin eso,
    /// una columna vacía se exportaría como 0 y nadie lo notaría hasta sumarla.
    /// </summary>
    [RequiresInformixSqliFact]
    public void UnNuloNoSeConfundeConCero()
    {
        using var conexion = Abrir();
        using var comando = conexion.CreateCommand();

        comando.CommandText = "SELECT FIRST 1 NULL::INTEGER AS vacio, 0 AS cero FROM systables";

        using var lector = comando.ExecuteReader();

        Assert.True(lector.Read());
        Assert.True(lector.IsDBNull(0));
        Assert.Equal(DBNull.Value, lector.GetValue(0));
        Assert.False(lector.IsDBNull(1));
        Assert.Equal(0, lector.GetInt32(1));
    }

    [RequiresInformixSqliFact]
    public void LosParametrosViajanTipadosYPorPosicion()
    {
        using var conexion = Abrir();
        using var comando = conexion.CreateCommand();

        // Los parámetros van en el WHERE y no en la lista de columnas: Informix
        // no admite un `?` suelto donde no puede deducir el tipo, y responde con
        // un «System or internal error» que no ayuda a nadie.
        comando.CommandText =
            "SELECT FIRST 1 tabname FROM systables WHERE tabname = ? AND tabid > ?";

        var nombre = comando.CreateParameter();
        nombre.Value = "systables";
        comando.Parameters.Add(nombre);

        var desde = comando.CreateParameter();
        desde.Value = 0;
        comando.Parameters.Add(desde);

        using var lector = comando.ExecuteReader();

        // Que vuelva justo la fila pedida demuestra las dos cosas: que los
        // valores llegaron y que llegaron **en su sitio**, que es lo que decide
        // la numeración por posición.
        Assert.True(lector.Read());
        Assert.Equal("systables", lector.GetString(0).Trim());
    }

    [RequiresInformixSqliFact]
    public void ElErrorDelMotorLlegaConSuEstadoSql()
    {
        using var conexion = Abrir();
        using var comando = conexion.CreateCommand();

        comando.CommandText = "SELECT * FROM tabla_que_no_existe";

        var error = Assert.Throws<JdbcException>(() => comando.ExecuteReader());

        Assert.False(string.IsNullOrWhiteSpace(error.Message));
        Assert.False(string.IsNullOrWhiteSpace(error.SqlStateValue));
    }

    [RequiresInformixSqliFact]
    public void CerrarElLectorNoTumbaLaConexion()
    {
        using var conexion = Abrir();

        using (var comando = conexion.CreateCommand())
        {
            comando.CommandText = "SELECT FIRST 1 1 FROM systables";

            using var lector = comando.ExecuteReader();

            Assert.True(lector.Read());
        }

        Assert.Equal(ConnectionState.Open, conexion.State);
    }
}
