using System.Net;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using Druse.Application.Ai;
using Druse.Domain;
using Druse.Host.LocalApi.Security;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;

namespace Druse.IntegrationTests;

public sealed class AiDiagnosticsTests
{
    private static readonly object Profile = new
    {
        name = "Codex de prueba", kind = "localcli", command = "codex", model = "gpt-6.1-sol",
        baseUrl = "", disclosure = "schema", ownSession = false, isDefault = false,
    };

    [Fact]
    public async Task ComprobarConfiguracionNoGeneraUnaRespuestaNiVerificaElModelo()
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        using var response = await client.PostAsJsonAsync("/api/ai/providers/test", Profile);
        response.EnsureSuccessStatusCode();
        using var json = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        Assert.True(json.RootElement.GetProperty("reachable").GetBoolean());
        Assert.False(json.RootElement.GetProperty("modelVerified").GetBoolean());
        Assert.Equal(0, provider.StreamCalls);
        Assert.Equal(1, provider.ProbeCalls);
    }

    [Fact]
    public async Task LaPruebaRealEnviaSoloElPromptMinimoYTerminaElStreaming()
    {
        var provider = new TestProvider();
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        using var response = await client.PostAsJsonAsync("/api/ai/providers/test-response", Profile);
        response.EnsureSuccessStatusCode();
        Assert.Equal("text/event-stream", response.Content.Headers.ContentType?.MediaType);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("event: chunk", body, StringComparison.Ordinal);
        Assert.Contains("event: done", body, StringComparison.Ordinal);
        Assert.DoesNotContain("event: error", body, StringComparison.Ordinal);
        Assert.Equal("gpt-6.1-sol", provider.LastRequest.Profile.Model);
        Assert.Single(provider.LastRequest.Messages);
        Assert.Contains("únicamente OK", provider.LastRequest.Messages[0].Text, StringComparison.Ordinal);
        Assert.Equal(AiRole.User, provider.LastRequest.Messages[0].Role);
    }

    [Theory]
    [InlineData("model is not supported", "unsupportedModel")]
    [InlineData("401 not logged in", "authentication")]
    [InlineData("429 quota exceeded", "quota")]
    [InlineData("connection refused", "network")]
    public async Task UnFalloLlegaComoErrorSseSinCambiarDeModelo(string detail, string code)
    {
        var nested = JsonSerializer.Serialize(new { error = new { message = detail } });
        var provider = new TestProvider { Failure = new AiProviderException(detail, nested) };
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        using var response = await client.PostAsJsonAsync("/api/ai/providers/test-response", Profile);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("event: error", body, StringComparison.Ordinal);
        Assert.DoesNotContain("event: done", body, StringComparison.Ordinal);
        using var json = JsonDocument.Parse(body.Split("data: ")[1].Trim());
        Assert.Equal(code, json.RootElement.GetProperty("code").GetString());
        Assert.Equal(detail, json.RootElement.GetProperty("message").GetString());
        Assert.Equal(nested, json.RootElement.GetProperty("detail").GetString());
        Assert.Equal(1, provider.StreamCalls);
        Assert.Equal("gpt-6.1-sol", provider.LastRequest.Profile.Model);
    }

    [Fact]
    public async Task CancelarLaPeticionCancelaElProveedor()
    {
        var provider = new TestProvider { WaitForCancellation = true };
        using var root = new DruseApiFactory();
        using var host = WithProvider(root, provider);
        using var client = Client(host);
        using var cancellation = new CancellationTokenSource(TimeSpan.FromSeconds(15));
        using var request = new HttpRequestMessage(HttpMethod.Post, "/api/ai/providers/test-response")
        {
            Content = JsonContent.Create(Profile),
        };
        using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellation.Token);
        using var stream = await response.Content.ReadAsStreamAsync(cancellation.Token);
        using var reader = new StreamReader(stream);
        Assert.Equal("event: chunk", await reader.ReadLineAsync(cancellation.Token));
        cancellation.Cancel();
        response.Dispose();
        await provider.Cancelled.Task.WaitAsync(TimeSpan.FromSeconds(10));
    }

    private static Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> WithProvider(DruseApiFactory root, TestProvider provider) =>
        root.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IAiProvider>();
            services.AddSingleton<IAiProvider>(provider);
        }));

    private static HttpClient Client(Microsoft.AspNetCore.Mvc.Testing.WebApplicationFactory<Program> host)
    {
        var client = host.CreateClient();
        client.DefaultRequestHeaders.Add("X-Druse-Token", host.Services.GetRequiredService<LocalApiEndpoint>().Token);
        return client;
    }

    private sealed class TestProvider : IAiProvider
    {
        public AiProviderKind Kind => AiProviderKind.LocalCli;
        public int ProbeCalls { get; private set; }
        public int StreamCalls { get; private set; }
        public AiRequest LastRequest { get; private set; }
        public Exception? Failure { get; init; }
        public bool WaitForCancellation { get; init; }
        public TaskCompletionSource Cancelled { get; } = new(TaskCreationOptions.RunContinuationsAsynchronously);

        public Task<AiProbe> ProbeAsync(AiRequest request, CancellationToken cancellationToken)
        {
            ProbeCalls++;
            return Task.FromResult(new AiProbe(true, "Instalado y con sesión; catálogo disponible.", 1));
        }

        public Task<IReadOnlyList<string>> ListModelsAsync(AiRequest request, CancellationToken cancellationToken) =>
            Task.FromResult<IReadOnlyList<string>>(["gpt-6.1-sol"]);

        public async IAsyncEnumerable<AiChunk> StreamAsync(AiRequest request, [EnumeratorCancellation] CancellationToken cancellationToken)
        {
            LastRequest = request;
            StreamCalls++;
            if (Failure is not null)
            {
                throw Failure;
            }
            yield return new AiChunk("OK");
            if (WaitForCancellation)
            {
                try
                {
                    await Task.Delay(Timeout.Infinite, cancellationToken);
                }
                finally
                {
                    if (cancellationToken.IsCancellationRequested)
                    {
                        Cancelled.TrySetResult();
                    }
                }
            }
        }
    }
}
