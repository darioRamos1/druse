using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Oracle;

namespace Druse.UnitTests;

/// <summary>
/// La cadena de conexión de Oracle, que es donde se decide **a qué se conecta**
/// Druse.
///
/// Aquí no basta con un host y una base: Oracle se conecta a un servicio, o a un
/// SID si la instalación es de las antiguas, y el cifrado no es una bandera sino
/// otro protocolo y otro escuchador. Nada de eso falla al compilar; falla al
/// abrir la primera sesión, contra un servidor que a lo mejor no se tiene
/// delante.
/// </summary>
public sealed class OracleConnectionStringTests
{
    private static ConnectionProfile Profile() => new()
    {
        Id = Guid.NewGuid(),
        Name = "Oracle de pruebas",
        Engine = DatabaseEngine.Oracle,
        Host = "127.0.0.1",
        Port = 1521,
        Database = "FREEPDB1",
        Username = "druse",
        ConnectTimeoutSeconds = 7,
    };

    private static DatabaseCredentials Credentials() => new() { Password = "no_importa" };

    [Fact]
    public void ElDescriptorLlevaElHostElPuertoYElServicio()
    {
        var descriptor = OracleConnectionStringFactory.Descriptor(Profile());

        Assert.Contains("(HOST=127.0.0.1)", descriptor, StringComparison.Ordinal);
        Assert.Contains("(PORT=1521)", descriptor, StringComparison.Ordinal);
        Assert.Contains("(SERVICE_NAME=FREEPDB1)", descriptor, StringComparison.Ordinal);
    }

    /// <summary>
    /// Un perfil sin base significa «la primera a la que tenga acceso» en los
    /// demás motores. Aquí no se puede preguntar sin conectar ni conectar sin
    /// nombrar el destino, así que hay que poner algo, y lo que se pone importa.
    /// </summary>
    [Fact]
    public void SinBaseVaAlServicioDeLaInstalacionDeSerie()
    {
        var descriptor = OracleConnectionStringFactory.Descriptor(Profile() with { Database = "" });

        Assert.Contains("(SERVICE_NAME=FREEPDB1)", descriptor, StringComparison.Ordinal);
    }

    /// <summary>
    /// El SID no es un campo del formulario —confundiría a la mayoría— pero quien
    /// lo necesita no puede quedarse sin salida: se escribe en las opciones.
    /// </summary>
    [Fact]
    public void ConLaOpcionSidSeHablaConUnSidYNoConUnServicio()
    {
        var profile = Profile() with
        {
            Options = new Dictionary<string, string> { ["Sid"] = "XE" },
        };

        var descriptor = OracleConnectionStringFactory.Descriptor(profile);

        Assert.Contains("(SID=XE)", descriptor, StringComparison.Ordinal);
        Assert.DoesNotContain("SERVICE_NAME", descriptor, StringComparison.Ordinal);
    }

    /// <summary>
    /// En Oracle exigir cifrado no es una bandera sobre la misma conexión: TCPS
    /// es otro protocolo, otro puerto y otro escuchador.
    /// </summary>
    [Theory]
    [InlineData(SslMode.Require)]
    [InlineData(SslMode.VerifyCA)]
    [InlineData(SslMode.VerifyFull)]
    public void ExigirCifradoCambiaElProtocolo(SslMode mode)
    {
        var descriptor = OracleConnectionStringFactory.Descriptor(Profile() with { SslMode = mode });

        Assert.Contains("(PROTOCOL=TCPS)", descriptor, StringComparison.Ordinal);
    }

    /// <summary>
    /// Y sin exigirlo se va por TCP, que es lo que responde el escuchador
    /// corriente: `Prefer` no puede «intentarlo y seguir si no» porque el otro
    /// extremo es un servicio distinto.
    /// </summary>
    [Theory]
    [InlineData(SslMode.Disable)]
    [InlineData(SslMode.Prefer)]
    public void SinExigirloSeVaPorElProtocoloCorriente(SslMode mode)
    {
        var descriptor = OracleConnectionStringFactory.Descriptor(Profile() with { SslMode = mode });

        Assert.Contains("(PROTOCOL=TCP)", descriptor, StringComparison.Ordinal);
        Assert.DoesNotContain("TCPS", descriptor, StringComparison.Ordinal);
    }

    [Fact]
    public void LaCadenaLlevaElUsuarioYElPlazoDelPerfil()
    {
        var connectionString = OracleConnectionStringFactory.Build(Profile(), Credentials());

        // Las claves las escribe ODP.NET, y las escribe en mayúsculas: se fijan
        // tal cual salen para que un cambio del driver se vea aquí y no al abrir
        // la primera sesión.
        Assert.Contains("USER ID=druse", connectionString, StringComparison.Ordinal);
        Assert.Contains("CONNECTION TIMEOUT=7", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// Las opciones del perfil son para lo que Druse no contempla, y no una
    /// puerta trasera para cambiar el destino: lo que ya tiene campo propio se
    /// ignora.
    /// </summary>
    [Fact]
    public void LasOpcionesNoPuedenPisarLoQueYaTieneCampoPropio()
    {
        var profile = Profile() with
        {
            Options = new Dictionary<string, string>
            {
                ["User ID"] = "otro",
                ["Data Source"] = "otro_sitio",
            },
        };

        var connectionString = OracleConnectionStringFactory.Build(profile, Credentials());

        Assert.Contains("USER ID=druse", connectionString, StringComparison.Ordinal);
        Assert.DoesNotContain("otro_sitio", connectionString, StringComparison.Ordinal);
    }
}
