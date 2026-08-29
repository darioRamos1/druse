using System.Net;
using System.Text;
using Druse.Application.Ai;
using Druse.Domain;
using Druse.Infrastructure.Ai;

namespace Druse.UnitTests;

public sealed class AnthropicProviderTests
{
    private static AiRequest Request() => new(
        new AiProviderProfile
        {
            Id = Guid.NewGuid(),
            Name = "Claude",
            Kind = AiProviderKind.Anthropic,
            BaseUrl = "https://api.anthropic.com/v1",
            Model = "claude-test",
        },
        "anthropic-key",
        [
            new AiMessage(AiRole.System, "Responde breve."),
            new AiMessage(AiRole.User, "hola"),
        ]);

    [Fact]
    public async Task LeeLosFragmentosDeMessages()
    {
        var provider = Given("""
            event: message_start
            data: {"type":"message_start"}

            event: content_block_delta
            data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"SELECT "}}

            event: content_block_delta
            data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"1"}}

            event: message_stop
            data: {"type":"message_stop"}

            """, out _);

        Assert.Equal(["SELECT ", "1"], await Collect(provider));
    }

    [Fact]
    public async Task UsaLaRutaCabecerasYSystemDeAnthropic()
    {
        var provider = Given("data: {\"type\":\"message_stop\"}\n\n", out var handler);

        await Collect(provider);

        Assert.Equal("https://api.anthropic.com/v1/messages", handler.LastUrl);
        Assert.Equal("anthropic-key", handler.Header("x-api-key"));
        Assert.Equal("2023-06-01", handler.Header("anthropic-version"));
        Assert.Contains("\"system\":\"Responde breve.\"", handler.LastBody, StringComparison.Ordinal);
        Assert.DoesNotContain("\"role\":\"system\"", handler.LastBody, StringComparison.Ordinal);
    }

    [Fact]
    public async Task EnumeraLosModelos()
    {
        var provider = Given("""{"data":[{"id":"claude-z"},{"id":"claude-a"}]}""", out _);

        var models = await provider.ListModelsAsync(Request(), CancellationToken.None);

        Assert.Equal(["claude-a", "claude-z"], models);
    }

    private static async Task<List<string>> Collect(AnthropicProvider provider)
    {
        var chunks = new List<string>();

        await foreach (var chunk in provider.StreamAsync(Request(), CancellationToken.None))
        {
            chunks.Add(chunk.Text);
        }

        return chunks;
    }

    private static AnthropicProvider Given(
        string body,
        out RecordingHandler handler,
        HttpStatusCode status = HttpStatusCode.OK)
    {
        handler = new RecordingHandler(body, status);
        return new AnthropicProvider(new HttpClient(handler));
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
