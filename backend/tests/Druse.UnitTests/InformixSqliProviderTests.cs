using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Informix;

namespace Druse.UnitTests;

/// <summary>
/// Informix por su protocolo nativo, visto desde el proveedor.
///
/// El puente ya está probado por su cuenta; lo que se comprueba aquí es el
/// cableado: que el motor nuevo abre por SQLI, que el servidor lógico llega
/// donde tiene que llegar, y que **faltar ese dato se cuenta como lo que es**
/// —un campo sin rellenar— y no como un fallo de red, que es lo que diría el
/// driver si se le dejara intentarlo.
/// </summary>
public sealed class InformixSqliProviderTests
{
    private static ConnectionProfile Perfil(string? servidor = "informix", string? baseDatos = null) =>
        new()
        {
            Id = Guid.NewGuid(),
            Name = "Informix por SQLI",
            Engine = DatabaseEngine.InformixSqli,
            Host = Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_HOST") ?? "127.0.0.1",
            Port = int.TryParse(
                Environment.GetEnvironmentVariable("DRUSE_TEST_IFX_SQLI_PORT"),
                System.Globalization.CultureInfo.InvariantCulture,
                out var puerto)
                ? puerto
                : 9088,
            Database = baseDatos ?? "sysmaster",
            Username = "informix",
            SslMode = SslMode.Disable,
            InformixServer = servidor,
        };

    private static readonly DatabaseCredentials Clave = new("in4mix");

    [Fact]
    public void ElMotorNuevoProponeElPuertoDeSuProtocolo()
    {
        var sqli = new InformixDatabaseProvider(DatabaseEngine.InformixSqli);
        var drda = new InformixDatabaseProvider(DatabaseEngine.Informix);

        // No es un detalle: poner el puerto del otro es el error que hace que la
        // conexión falle con un mensaje que parece de credenciales.
        Assert.Equal(9088, sqli.DefaultPort);
        Assert.Equal(9089, drda.DefaultPort);
    }

    [Fact]
    public void EsteProveedorNoAtiendeAOtrosMotores()
    {
        Assert.Throws<ArgumentOutOfRangeException>(
            () => new InformixDatabaseProvider(DatabaseEngine.PostgreSql));
    }

    [RequiresInformixSqliFact]
    public async Task AbreLaSesionYDiceQueVersionHayAlOtroLado()
    {
        var provider = new InformixDatabaseProvider(DatabaseEngine.InformixSqli);

        await using var sesion = await provider.OpenSessionAsync(
            Perfil(),
            Clave,
            CancellationToken.None);

        Assert.True(sesion.IsOpen);
        Assert.Equal(DatabaseEngine.InformixSqli, sesion.Engine);
        Assert.False(string.IsNullOrWhiteSpace(sesion.ServerVersion));
    }

    [RequiresInformixSqliFact]
    public async Task ProbarLaConexionFuncionaPorSqli()
    {
        var provider = new InformixDatabaseProvider(DatabaseEngine.InformixSqli);

        var resultado = await provider.TestConnectionAsync(
            Perfil(),
            Clave,
            CancellationToken.None);

        Assert.True(resultado.Succeeded, resultado.Error?.Message);
        Assert.False(string.IsNullOrWhiteSpace(resultado.ServerVersion));
    }

    /// <summary>
    /// Sin servidor lógico no se intenta siquiera.
    ///
    /// Es la diferencia entre «te falta un campo» y el error de red que devuelve
    /// el driver, que manda a mirar el cortafuegos cuando el problema está en el
    /// formulario.
    /// </summary>
    [RequiresInformixSqliFact]
    public async Task SinServidorLogicoLoDiceEnVezDeIntentarlo()
    {
        var provider = new InformixDatabaseProvider(DatabaseEngine.InformixSqli);

        var resultado = await provider.TestConnectionAsync(
            Perfil(servidor: null),
            Clave,
            CancellationToken.None);

        Assert.False(resultado.Succeeded);
        Assert.Contains(
            "servidor Informix",
            resultado.Error?.Message ?? "",
            StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Un error de sintaxis se cuenta como tal, no como «error interno».
    ///
    /// Este driver **no deja llegar la sintaxis al servidor**: la caza su propio
    /// parser y responde con un código suyo y un «System or internal error» que
    /// no le dice nada a nadie. Comprobado contra el servidor que todo lo demás
    /// sí viaja y vuelve con su número de Informix —-206, -217, -674—, así que
    /// este es el único caso que hay que traducir.
    ///
    /// Se mira el mensaje y no solo el código porque es lo que el usuario lee.
    /// </summary>
    [RequiresInformixSqliFact]
    public async Task UnErrorDeSintaxisSeExplicaEnVezDeLlamarseInterno()
    {
        var provider = new InformixDatabaseProvider(DatabaseEngine.InformixSqli);
        var executor = new InformixQueryExecutor(DatabaseEngine.InformixSqli);

        await using var sesion = await provider.OpenSessionAsync(
            Perfil(),
            Clave,
            CancellationToken.None);

        var resultado = await executor.ExecuteAsync(
            sesion,
            new QueryRequest
            {
                SessionId = sesion.Id,
                Sql = "SELECT * FORM systables",
                MaxRows = 10,
                TimeoutSeconds = 30,
            },
            CancellationToken.None);

        Assert.Equal(QueryExecutionState.Failed, resultado.State);

        // El número que Informix usa para la sintaxis, el mismo que por DRDA.
        Assert.Equal("-201", resultado.Error?.Code);

        // Y sobre todo: lo que se enseña ya no es el mensaje del driver.
        Assert.DoesNotContain(
            "System or internal error",
            resultado.Error?.Message ?? "",
            StringComparison.OrdinalIgnoreCase);
        Assert.Contains(
            "sintaxis",
            resultado.Error?.Message ?? "",
            StringComparison.OrdinalIgnoreCase);
    }

    [RequiresInformixSqliFact]
    public async Task UnaBaseQueNoExisteSeCuentaConElMensajeDelMotor()
    {
        var provider = new InformixDatabaseProvider(DatabaseEngine.InformixSqli);

        var resultado = await provider.TestConnectionAsync(
            Perfil(baseDatos: "base_que_no_existe"),
            Clave,
            CancellationToken.None);

        Assert.False(resultado.Succeeded);
        Assert.False(string.IsNullOrWhiteSpace(resultado.Error?.Message));
    }
}
