using System.Net;
using System.Text;
using Druse.Application.Ai;
using Druse.Domain;
using Druse.Infrastructure.Ai;

namespace Druse.UnitTests;

public sealed class GeminiProviderTests
{
    private static AiRequest Request() => new(
        new AiProviderProfile
        {
            Id = Guid.NewGuid(),
            Name = "Gemini",
            Kind = AiProviderKind.Gemini,
            BaseUrl = "https://generativelanguage.googleapis.com/v1beta",
            Model = "gemini-test",
        },
        "gemini-key",
        [
            new AiMessage(AiRole.System, "Responde breve."),
            new AiMessage(AiRole.User, "hola"),
        ]);

    [Fact]
    public async Task LeeLosFragmentosDeGenerateContent()
    {
        var provider = Given("""
            data: {"candidates":[{"content":{"parts":[{"text":"SELECT "}]}}]}

            data: {"candidates":[{"content":{"parts":[{"text":"1"}]}}]}

            """, out _);

        Assert.Equal(["SELECT ", "1"], await Collect(provider));
    }

    [Fact]
    public async Task UsaLaRutaCabeceraYSystemDeGemini()
    {
        var provider = Given("", out var handler);

        await Collect(provider);

        Assert.Equal(
            "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse",
            handler.LastUrl);
        Assert.Equal("gemini-key", handler.Header("x-goog-api-key"));
        Assert.Contains("\"systemInstruction\"", handler.LastBody, StringComparison.Ordinal);
        Assert.Contains("\"role\":\"user\"", handler.LastBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task EnumeraSoloModelosQueGeneranContenido()
    {
        var provider = Given("""
            {"models":[
              {"name":"models/gemini-b","supportedGenerationMethods":["generateContent"]},
              {"name":"models/embedding-1","supportedGenerationMethods":["embedContent"]},
              {"name":"models/gemini-a","supportedGenerationMethods":["generateContent"]}
            ]}
            """, out _);

        var models = await provider.ListModelsAsync(Request(), CancellationToken.None);

        Assert.Equal(["gemini-a", "gemini-b"], models);
    }

    private static async Task<List<string>> Collect(GeminiProvider provider)
    {
        var chunks = new List<string>();

        await foreach (var chunk in provider.StreamAsync(Request(), CancellationToken.None))
        {
            chunks.Add(chunk.Text);
        }

        return chunks;
    }

    private static GeminiProvider Given(
        string body,
        out RecordingHandler handler,
        HttpStatusCode status = HttpStatusCode.OK)
    {
        handler = new RecordingHandler(body, status);
        return new GeminiProvider(new HttpClient(handler));
    }

    private sealed class RecordingHandler(string body, HttpStatusCode status) : HttpMessageHandler
    {
        private readonly Dictionary<string, string> _headers = new(StringComparer.OrdinalIgnoreCase);

        public string? LastUrl { get; private set; }
        public string LastBody { get; private set; } = string.Empty;
        public string? Header(string name) => _headers.GetValueOrDefault(name);

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            LastUrl = request.RequestUri?.ToString();
            LastBody = request.Content is null
                ? string.Empty
                : await request.Content.ReadAsStringAsync(cancellationToken);

            foreach (var header in request.Headers)
            {
                _headers[header.Key] = string.Join(",", header.Value);
            }

            return new HttpResponseMessage(status)
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
        }
    }
}
