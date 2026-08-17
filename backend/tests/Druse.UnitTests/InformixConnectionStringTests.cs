using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Informix;

namespace Druse.UnitTests;

/// <summary>
/// La cadena de conexión de Informix, que es lo primero que se ejecuta al
/// conectar y lo último que alguien revisa.
///
/// Estas pruebas existen porque el proveedor entró entero sin ejecutarse contra
/// un servidor: un valor mal tipado aquí no falla al compilar, falla al abrir la
/// primera sesión y con un mensaje que no menciona a Informix.
/// </summary>
public class InformixConnectionStringTests
{
    private static ConnectionProfile Profile() => new()
    {
        Id = Guid.NewGuid(),
        Name = "Informix de pruebas",
        Engine = DatabaseEngine.Informix,
        Host = "127.0.0.1",
        Port = 9089,
        Database = "druse_test",
        Username = "informix",
        ConnectTimeoutSeconds = 5,
    };

    private static DatabaseCredentials Credentials() => new() { Password = "no_importa" };

    [Fact]
    public void SeConstruyeSinReventar()
    {
        var connectionString = InformixConnectionStringFactory.Build(Profile(), Credentials());

        Assert.Contains("druse_test", connectionString);
        Assert.Contains("127.0.0.1:9089", connectionString);
    }

    /// <summary>
    /// Sin DELIMIDENT, Informix lee `"nombre"` como la cadena literal y no como
    /// la columna, así que todo el SQL que genera Druse dejaría de funcionar en
    /// cuanto un identificador necesite comillas.
    ///
    /// El valor exacto importa y por eso se fija aquí: el driver de IBM acepta
    /// `1`, pero rechaza `Y` y `True` con «Invalid argument» al conectar.
    /// </summary>
    [Fact]
    public void PideIdentificadoresDelimitadosConElValorQueElDriverAcepta()
    {
        var connectionString = InformixConnectionStringFactory.Build(Profile(), Credentials());

        Assert.Contains("DELIMIDENT=1", connectionString, StringComparison.Ordinal);
        Assert.DoesNotContain("DelimIdent=True", connectionString, StringComparison.Ordinal);
    }

    /// <summary>
    /// Un perfil no puede colar su propio DELIMIDENT: además de romper el SQL
    /// generado, pasar esa clave por el constructor de IBM revienta.
    /// </summary>
    [Fact]
    public void ElPerfilNoPuedeCambiarElDelimIdent()
    {
        var profile = Profile() with
        {
            Options = new Dictionary<string, string> { ["DELIMIDENT"] = "Y" },
        };

        var connectionString = InformixConnectionStringFactory.Build(profile, Credentials());

        Assert.Contains("DELIMIDENT=1", connectionString, StringComparison.Ordinal);
        Assert.DoesNotContain("DELIMIDENT=Y", connectionString, StringComparison.Ordinal);
    }

    [Fact]
    public void LaBaseIndicadaGanaALaDelPerfil()
    {
        var connectionString = InformixConnectionStringFactory.Build(
            Profile(),
            Credentials(),
            "otra_base");

        Assert.Contains("otra_base", connectionString);
        Assert.DoesNotContain("druse_test", connectionString);
    }
}
