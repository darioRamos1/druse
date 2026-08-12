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
    public void ExigeServidorBaseYUsuario()
    {
        var profile = Valid() with { Host = "", Database = "", Username = "" };

        var result = ConnectionProfileValidator.Validate(profile);

        Assert.False(result.IsValid);
        Assert.Equal(3, result.Errors.Count);
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
