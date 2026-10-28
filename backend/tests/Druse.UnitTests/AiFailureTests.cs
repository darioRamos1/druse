using System.Net;
using System.Text.Json;
using Druse.Application.Ai;

namespace Druse.UnitTests;

public sealed class AiFailureTests
{
    [Fact]
    public void ExtraeElRechazoAnidadoYConservaElDetalleSinLaClave()
    {
        const string message = "The 'gpt-6.1-sol' model is not supported with this ChatGPT account.";
        var original = JsonSerializer.Serialize(new { error = new { message, key = "clave-de-prueba" } });
        var wrapped = JsonSerializer.Serialize(new { message = original });
        var result = AiFailure.From(new AiProviderException(wrapped, wrapped), "clave-de-prueba");
        Assert.Equal("unsupportedModel", result.Code);
        Assert.Equal(message, result.Message);
        Assert.Contains("[clave omitida]", result.Detail, StringComparison.Ordinal);
        Assert.DoesNotContain("clave-de-prueba", result.Detail, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("401 not logged in", "authentication")]
    [InlineData("quota exceeded", "quota")]
    [InlineData("connection refused", "network")]
    [InlineData("un fallo desconocido", "other")]
    public void DistingueLaCausaDelFallo(string detail, string expected)
    {
        Assert.Equal(expected, AiFailure.From(new InvalidOperationException(detail)).Code);
    }

    [Theory]
    [InlineData(HttpStatusCode.Unauthorized, "authentication")]
    [InlineData(HttpStatusCode.Forbidden, "authentication")]
    [InlineData(HttpStatusCode.TooManyRequests, "quota")]
    public void ElEstadoHttpTambienIdentificaLaCausa(HttpStatusCode status, string expected)
    {
        Assert.Equal(expected, AiFailure.From(new HttpRequestException("fallo", null, status)).Code);
    }

    [Theory]
    [InlineData("{sin terminar")]
    [InlineData("[]")]
    [InlineData("{}")]
    public void UnDetalleNoReconocidoSigueDisponible(string text)
    {
        Assert.Equal(text, AiFailure.ReadMessage(text));
    }
}
