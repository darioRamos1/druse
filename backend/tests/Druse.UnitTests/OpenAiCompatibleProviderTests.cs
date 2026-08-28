using System.Net;
using System.Text;
using Druse.Application.Ai;
using Druse.Domain;
using Druse.Infrastructure.Ai;

namespace Druse.UnitTests;

/// <summary>
/// El formato de OpenAI leído trozo a trozo.
///
/// Se prueba contra un servidor de mentira y no contra uno real a propósito: lo
/// que puede romperse aquí es el análisis del flujo —una línea de comentario, un
/// trozo sin texto, un JSON a medias—, y eso no depende de qué proveedor haya al
/// otro lado.
/// </summary>
public sealed class OpenAiCompatibleProviderTests
{
    private static AiProviderProfile Profile() => new()
    {
        Id = Guid.NewGuid(),
        Name = "MaaS",
        Kind = AiProviderKind.OpenAiCompatible,
        BaseUrl = "https://ejemplo.local/v1",
        Model = "modelo-de-prueba",
    };

    private static AiRequest Request(string? key = "clave") =>
        new(Profile(), key, [new AiMessage(AiRole.User, "hola")]);

    [Fact]
    public async Task DevuelveElTextoTrozoATrozo()
    {
        var provider = Given("""
            data: {"choices":[{"delta":{"role":"assistant"}}]}

            data: {"choices":[{"delta":{"content":"SELECT "}}]}

            data: {"choices":[{"delta":{"content":"1"}}]}

            data: [DONE]

            """, out _);

        var trozos = await Collect(provider);

        Assert.Equal(["SELECT ", "1"], trozos);
    }

    /// <summary>
    /// Algunos proveedores mandan comentarios para que la conexión no caduque.
    /// Tratarlos como datos rompería el análisis a media respuesta.
    /// </summary>
    [Fact]
    public async Task IgnoraComentariosYLineasEnBlanco()
    {
        var provider = Given("""
            : ping

            data: {"choices":[{"delta":{"content":"hola"}}]}

            : ping

            data: [DONE]

            """, out _);

        Assert.Equal(["hola"], await Collect(provider));
    }

    /// <summary>
    /// Una línea que no se entiende no puede llevarse por delante lo ya escrito.
    /// </summary>
    [Fact]
    public async Task UnTrozoRotoNoCortaLaRespuesta()
    {
        var provider = Given("""
            data: {"choices":[{"delta":{"content":"antes"}}]}

            data: {esto no es json

            data: {"choices":[{"delta":{"content":"después"}}]}

            data: [DONE]

            """, out _);

        Assert.Equal(["antes", "después"], await Collect(provider));
    }

    /// <summary>El último trozo trae el motivo de la parada y ningún texto.</summary>
    [Fact]
    public async Task UnTrozoSinTextoNoAportaNada()
    {
        var provider = Given("""
            data: {"choices":[{"delta":{"content":"todo"},"finish_reason":null}]}

            data: {"choices":[{"delta":{},"finish_reason":"stop"}]}

            data: [DONE]

            """, out _);

        Assert.Equal(["todo"], await Collect(provider));
    }

    [Fact]
    public async Task PideLaRutaDeChatSobreLaUrlBase()
    {
        var provider = Given("data: [DONE]\n\n", out var handler);

        await Collect(provider);

        Assert.Equal("https://ejemplo.local/v1/chat/completions", handler.LastUrl);
    }

    /// <summary>
    /// Ollama y LM Studio no piden clave, y `Bearer ` a secas lo rechazan algunos.
    /// </summary>
    [Fact]
    public async Task SinClaveNoMandaLaCabecera()
    {
        var provider = Given("data: [DONE]\n\n", out var handler);

        await Collect(provider, Request(key: null));

        Assert.Null(handler.LastAuthorization);
    }

    [Fact]
    public async Task ConClaveLaMandaComoBearer()
    {
        var provider = Given("data: [DONE]\n\n", out var handler);

        await Collect(provider);

        Assert.Equal("Bearer clave", handler.LastAuthorization);
    }

    /// <summary>
    /// El motivo real del fallo está en el cuerpo; enseñar solo «401» esconde
    /// justo el dato que resuelve el problema.
    /// </summary>
    [Fact]
    public async Task ExplicaLaClaveRechazada()
    {
        var provider = Given(
            """{"error":{"message":"Invalid API key"}}""",
            out _,
            HttpStatusCode.Unauthorized);

        var error = await Assert.ThrowsAsync<InvalidOperationException>(
            async () => await Collect(provider));

        Assert.Contains("clave", error.Message, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Invalid API key", error.Message, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProbarDiceCuantoTardoYQueRespondio()
    {
        var provider = Given("""{"choices":[{"message":{"content":"ok"}}]}""", out _);

        var probe = await provider.ProbeAsync(Request(), CancellationToken.None);

        Assert.True(probe.Reachable);
        Assert.Contains("modelo-de-prueba", probe.Detail, StringComparison.Ordinal);
    }

    [Fact]
    public async Task ProbarNoLanzaCuandoElProveedorFalla()
    {
        var provider = Given("nada", out _, HttpStatusCode.NotFound);

        var probe = await provider.ProbeAsync(Request(), CancellationToken.None);

        Assert.False(probe.Reachable);
        Assert.Contains("404", probe.Detail, StringComparison.Ordinal);
    }

    private static async Task<List<string>> Collect(
        OpenAiCompatibleProvider provider,
        AiRequest? request = null)
    {
        var trozos = new List<string>();

        await foreach (var chunk in provider.StreamAsync(
            request ?? Request(),
            CancellationToken.None))
        {
            trozos.Add(chunk.Text);
        }

        return trozos;
    }

    private static OpenAiCompatibleProvider Given(
        string body,
        out FakeHandler handler,
        HttpStatusCode status = HttpStatusCode.OK)
    {
        handler = new FakeHandler(body, status);

        return new OpenAiCompatibleProvider(new HttpClient(handler));
    }

    /// <summary>Un servidor de mentira que devuelve siempre lo mismo y apunta qué le pidieron.</summary>
    private sealed class FakeHandler(string body, HttpStatusCode status) : HttpMessageHandler
    {
        public string? LastUrl { get; private set; }

        public string? LastAuthorization { get; private set; }

        protected override Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            LastUrl = request.RequestUri?.ToString();
            LastAuthorization = request.Headers.Authorization?.ToString();

            return Task.FromResult(new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "text/event-stream"),
            });
        }
    }
}
