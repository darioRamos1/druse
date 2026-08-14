using Druse.Application.Connections;
using Druse.Domain;

namespace Druse.UnitTests;

public sealed class ConnectionProfileValidatorTests
{
    private static ConnectionProfile Valid() => new()
    {
        Id = Guid.NewGuid(),
        Name = "PostgreSQL local",
        Engine = DatabaseEngine.PostgreSql,
        Host = "127.0.0.1",
        Port = 5432,
        Database = "druse_test",
        Username = "postgres",
    };

    [Fact]
    public void AceptaUnPerfilCompleto()
    {
        var result = ConnectionProfileValidator.Validate(Valid());

        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void RechazaUnPerfilNulo()
    {
        var result = ConnectionProfileValidator.Validate(null);

        Assert.False(result.IsValid);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ExigeNombre(string name)
    {
        var result = ConnectionProfileValidator.Validate(Valid() with { Name = name });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("nombre", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    [InlineData(65536)]
    public void RechazaPuertosFueraDeRango(int port)
    {
        var result = ConnectionProfileValidator.Validate(Valid() with { Port = port });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("puerto", StringComparison.OrdinalIgnoreCase));
    }

    [Theory]
    [InlineData(1)]
    [InlineData(5432)]
    [InlineData(65535)]
    public void AceptaPuertosValidos(int port)
    {
        Assert.True(ConnectionProfileValidator.Validate(Valid() with { Port = port }).IsValid);
    }

    [Fact]
    public void UnaInstanciaConNombreDeSqlServerNoExigePuerto()
    {
        var profile = Valid() with
        {
            Engine = DatabaseEngine.SqlServer,
            Host = @"localhost\SQLEXPRESS",
            Port = 0,
        };

        Assert.True(ConnectionProfileValidator.Validate(profile).IsValid);
    }

    [Fact]
    public void ExigeServidorBaseYUsuario()
    {
        var profile = Valid() with { Host = "", Database = "", Username = "" };

        var result = ConnectionProfileValidator.Validate(profile);

        Assert.False(result.IsValid);
        Assert.Equal(3, result.Errors.Count);
    }

    /// <summary>Perfil de SQL Server con la identidad de la sesión de Windows.</summary>
    private static ConnectionProfile Integrated() => Valid() with
    {
        Engine = DatabaseEngine.SqlServer,
        Port = 1433,
        Username = string.Empty,
        Authentication = AuthenticationMode.Windows,
    };

    [Fact]
    public void LaAutenticacionDeWindowsNoExigeUsuario()
    {
        var result = ConnectionProfileValidator.Validate(Integrated());

        // Fuera de Windows el propio validador la rechaza, y ahí la prueba solo
        // puede comprobar que no es el usuario lo que falta.
        if (OperatingSystem.IsWindows())
        {
            Assert.True(result.IsValid);
        }
        else
        {
            Assert.DoesNotContain(result.Errors, error =>
                error.Contains("usuario", StringComparison.OrdinalIgnoreCase));
        }
    }

    [Theory]
    [InlineData(DatabaseEngine.PostgreSql)]
    [InlineData(DatabaseEngine.MySql)]
    public void LaAutenticacionDeWindowsSoloValeParaSqlServer(DatabaseEngine engine)
    {
        var result = ConnectionProfileValidator.Validate(Integrated() with { Engine = engine });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error =>
            error.Contains("SQL Server", StringComparison.Ordinal));
    }

    [Fact]
    public void RechazaUnMetodoDeAutenticacionDesconocido()
    {
        var profile = Valid() with { Authentication = (AuthenticationMode)7 };

        Assert.False(ConnectionProfileValidator.Validate(profile).IsValid);
    }

    [Fact]
    public void RechazaUnMotorDesconocido()
    {
        var result = ConnectionProfileValidator.Validate(Valid() with { Engine = (DatabaseEngine)99 });

        Assert.False(result.IsValid);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(301)]
    public void RechazaTiemposDeEsperaAbsurdos(int seconds)
    {
        var result = ConnectionProfileValidator.Validate(Valid() with { ConnectTimeoutSeconds = seconds });

        Assert.False(result.IsValid);
    }

    private static SshTunnelSettings Tunnel() => new()
    {
        Host = "bastion.empresa.com",
        Port = 22,
        Username = "operador",
    };

    [Fact]
    public void AceptaUnPerfilConTunel()
    {
        var profile = Valid() with { SshTunnel = Tunnel() };

        Assert.True(ConnectionProfileValidator.Validate(profile).IsValid);
    }

    [Fact]
    public void ExigeServidorYUsuarioDelTunel()
    {
        var profile = Valid() with
        {
            SshTunnel = Tunnel() with { Host = "", Username = "" },
        };

        var result = ConnectionProfileValidator.Validate(profile);

        Assert.False(result.IsValid);
        Assert.Equal(2, result.Errors.Count);
        // El error dice «del túnel SSH» para que no se confunda con el del motor.
        Assert.All(result.Errors, error =>
            Assert.Contains("túnel SSH", error, StringComparison.Ordinal));
    }

    [Fact]
    public void ConClavePrivadaExigeElArchivo()
    {
        var profile = Valid() with
        {
            SshTunnel = Tunnel() with { Authentication = SshAuthenticationMode.PrivateKey },
        };

        var result = ConnectionProfileValidator.Validate(profile);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error =>
            error.Contains("clave privada", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void RechazaPuertosDeTunelFueraDeRango()
    {
        var profile = Valid() with { SshTunnel = Tunnel() with { Port = 0 } };

        Assert.False(ConnectionProfileValidator.Validate(profile).IsValid);
    }

    [Fact]
    public void UnaInstanciaConNombreSiExigePuertoCuandoHayTunel()
    {
        // Sin túnel este mismo perfil es válido; con túnel no, porque un reenvío
        // necesita un puerto TCP concreto al que apuntar.
        var profile = Valid() with
        {
            Engine = DatabaseEngine.SqlServer,
            Host = @"localhost\SQLEXPRESS",
            Port = 0,
            SshTunnel = Tunnel(),
        };

        var result = ConnectionProfileValidator.Validate(profile);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error =>
            error.Contains("puerto", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void ElTunelNoTieneSitioParaLaContrasena()
    {
        // Misma comprobación estructural que la del perfil: el secreto del túnel
        // vive en el almacén del sistema, no en lo que se persiste (plan §12).
        var properties = typeof(SshTunnelSettings)
            .GetProperties()
            .Select(property => property.Name)
            .ToList();

        Assert.DoesNotContain(properties, name =>
            name.Contains("password", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("passphrase", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("secret", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void ElPerfilNoTieneSitioParaLaContrasena()
    {
        // Comprobación estructural: si alguien añade una propiedad de contraseña al
        // perfil, esta prueba falla y obliga a justificarlo (plan §12).
        var properties = typeof(ConnectionProfile)
            .GetProperties()
            .Select(property => property.Name)
            .ToList();

        Assert.DoesNotContain(properties, name =>
            name.Contains("password", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("secret", StringComparison.OrdinalIgnoreCase) ||
            name.Contains("credential", StringComparison.OrdinalIgnoreCase));
    }
}
