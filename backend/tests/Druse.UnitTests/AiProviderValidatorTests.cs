using Druse.Application.Ai;
using Druse.Domain;

namespace Druse.UnitTests;

public sealed class AiProviderValidatorTests
{
    private static AiProviderProfile Valid() => new()
    {
        Id = Guid.NewGuid(),
        Name = "MaaS corporativo",
        Kind = AiProviderKind.OpenAiCompatible,
        BaseUrl = "https://api.modelarts-maas.com/v1",
        Model = "DeepSeek-V3",
    };

    [Fact]
    public void AceptaUnProveedorCompleto()
    {
        var result = AiProviderValidator.Validate(Valid());

        Assert.True(result.IsValid);
        Assert.Empty(result.Errors);
    }

    [Fact]
    public void RechazaUnProveedorNulo()
    {
        Assert.False(AiProviderValidator.Validate(null).IsValid);
    }

    [Theory]
    [InlineData("")]
    [InlineData("   ")]
    public void ExigeNombre(string name)
    {
        var result = AiProviderValidator.Validate(Valid() with { Name = name });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("nombre", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void ExigeModelo()
    {
        var result = AiProviderValidator.Validate(Valid() with { Model = "  " });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("modelo", StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// El error que comete todo el mundo: pegar el `curl` de la documentación.
    ///
    /// Sin este aviso, Druse pide `/v1/chat/completions/chat/completions` y el
    /// proveedor responde 404, que no dice qué sobra.
    /// </summary>
    [Theory]
    [InlineData("https://api.modelarts-maas.com/v1/chat/completions")]
    [InlineData("https://api.openai.com/v1/chat/completions")]
    public void AvisaSiLaUrlYaLlevaLaRuta(string url)
    {
        var result = AiProviderValidator.Validate(Valid() with { BaseUrl = url });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("/chat/completions", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData("modelarts-maas.com/v1")]
    [InlineData("ftp://algo/v1")]
    public void ExigeHttpOHttps(string url)
    {
        Assert.False(AiProviderValidator.Validate(Valid() with { BaseUrl = url }).IsValid);
    }

    /// <summary>
    /// Un servidor interno sin cifrar se admite: **avisar no es prohibir**.
    ///
    /// Rechazarlo empujaba a escribir `https` sobre un puerto que sirve texto
    /// plano, y eso falla con un error de TLS que no dice qué cambiar. Quién
    /// puede espiar una red interna lo sabe quien la administra, no Druse.
    /// </summary>
    [Fact]
    public void AdmiteUnServidorInternoSinCifrar()
    {
        var result = AiProviderValidator.Validate(
            Valid() with { BaseUrl = "http://maas.interno.empresa/v1" });

        Assert.True(result.IsValid);
    }

    /// <summary>
    /// En `localhost` no hay red que espiar, y es donde vive Ollama.
    /// </summary>
    [Theory]
    [InlineData("http://localhost:11434/v1")]
    [InlineData("http://127.0.0.1:1234/v1")]
    public void AdmiteHttpEnEsteEquipo(string url)
    {
        var result = AiProviderValidator.Validate(
            Valid() with { Name = "Ollama", BaseUrl = url, Model = "qwen2.5-coder" });

        Assert.True(result.IsValid);
    }

    /// <summary>
    /// El proveedor por línea de órdenes no habla por red: exigirle una URL
    /// obligaría a inventarse una que nadie usa.
    /// </summary>
    [Fact]
    public void ElProveedorPorLineaDeOrdenesNoNecesitaUrl()
    {
        var result = AiProviderValidator.Validate(new AiProviderProfile
        {
            Id = Guid.NewGuid(),
            Name = "Claude Pro",
            Kind = AiProviderKind.LocalCli,
            Command = "claude",
            Model = "opus",
        });

        Assert.True(result.IsValid);
    }

    [Fact]
    public void CodexPuedeUsarElModeloPredeterminadoDeLaCuenta()
    {
        var result = AiProviderValidator.Validate(new AiProviderProfile
        {
            Id = Guid.NewGuid(),
            Name = "ChatGPT",
            Kind = AiProviderKind.LocalCli,
            Command = "codex",
            Model = "",
        });

        Assert.True(result.IsValid);
    }

    [Fact]
    public void ElProveedorPorLineaDeOrdenesExigeSuPrograma()
    {
        var result = AiProviderValidator.Validate(new AiProviderProfile
        {
            Id = Guid.NewGuid(),
            Name = "Claude Pro",
            Kind = AiProviderKind.LocalCli,
            Command = "",
            Model = "opus",
        });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("programa", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public void ElProveedorPorLineaDeOrdenesRechazaProgramasArbitrarios()
    {
        var result = AiProviderValidator.Validate(new AiProviderProfile
        {
            Id = Guid.NewGuid(),
            Name = "Programa desconocido",
            Kind = AiProviderKind.LocalCli,
            Command = "powershell",
            Model = "algo",
        });

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("claude", StringComparison.OrdinalIgnoreCase));
    }
}
