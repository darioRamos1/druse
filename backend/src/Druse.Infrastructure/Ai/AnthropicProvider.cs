using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Druse.Application.Ai;
using Druse.Domain;

namespace Druse.Infrastructure.Ai;

/// <summary>Habla con la API nativa Messages de Anthropic.</summary>
public sealed class AnthropicProvider(HttpClient http) : IAiProvider
{
    private const string ApiVersion = "2023-06-01";
    private readonly HttpClient _http = http;

    public AiProviderKind Kind => AiProviderKind.Anthropic;

    public async IAsyncEnumerable<AiChunk> StreamAsync(
        AiRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        using var message = BuildRequest(request, stream: true, maxTokens: 4096);
        using var response = await _http.SendAsync(
            message,
            HttpCompletionOption.ResponseHeadersRead,
            cancellationToken);

        await EnsureAnsweredAsync(response, cancellationToken);
        await using var body = await response.Content.ReadAsStreamAsync(cancellationToken);
        using var reader = new StreamReader(body, Encoding.UTF8);

        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            if (!line.StartsWith("data:", StringComparison.Ordinal))
            {
                continue;
            }

            var text = ExtractDelta(line["data:".Length..].Trim());

            if (text.Length > 0)
            {
                yield return new AiChunk(text);
            }
        }
    }

    public async Task<IReadOnlyList<string>> ListModelsAsync(
        AiRequest request,
        CancellationToken cancellationToken)
    {
        using var message = new HttpRequestMessage(
            HttpMethod.Get,
            $"{request.Profile.BaseUrl.TrimEnd('/')}/models");
        AddHeaders(message, request.ApiKey);

        using var response = await _http.SendAsync(message, cancellationToken);
        await EnsureAnsweredAsync(response, cancellationToken);
        using var document = JsonDocument.Parse(
            await response.Content.ReadAsStringAsync(cancellationToken));

        if (!document.RootElement.TryGetProperty("data", out var data)
            || data.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return [.. data
            .EnumerateArray()
            .Select(item => item.TryGetProperty("id", out var id) ? id.GetString() : null)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id!)
            .Order(StringComparer.OrdinalIgnoreCase)];
    }

    public async Task<AiProbe> ProbeAsync(AiRequest request, CancellationToken cancellationToken)
    {
        var clock = Stopwatch.StartNew();

        try
        {
            using var message = BuildRequest(request, stream: false, maxTokens: 1);
            using var response = await _http.SendAsync(message, cancellationToken);
            clock.Stop();

            return response.IsSuccessStatusCode
                ? new AiProbe(true, $"{request.Profile.Model} respondió.", clock.ElapsedMilliseconds)
                : new AiProbe(
                    false,
                    await ReadFailureAsync(response, cancellationToken),
                    clock.ElapsedMilliseconds);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            clock.Stop();
            return new AiProbe(false, error.Message, clock.ElapsedMilliseconds);
        }
    }

    private static HttpRequestMessage BuildRequest(AiRequest request, bool stream, int maxTokens)
    {
        var system = string.Join(
            "\n\n",
            request.Messages.Where(message => message.Role == AiRole.System).Select(message => message.Text));
        var payload = new Dictionary<string, object>
        {
            ["model"] = request.Profile.Model,
            ["max_tokens"] = maxTokens,
            ["stream"] = stream,
            ["messages"] = request.Messages
                .Where(message => message.Role != AiRole.System)
                .Select(message => new
                {
                    role = message.Role == AiRole.Assistant ? "assistant" : "user",
                    content = message.Text,
                })
                .ToArray(),
        };

        if (system.Length > 0)
        {
            payload["system"] = system;
        }

        var message = new HttpRequestMessage(
            HttpMethod.Post,
            $"{request.Profile.BaseUrl.TrimEnd('/')}/messages")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json"),
        };
        AddHeaders(message, request.ApiKey);

        return message;
    }

    private static void AddHeaders(HttpRequestMessage message, string? apiKey)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Falta la clave API de Anthropic.");
        }

        message.Headers.Add("x-api-key", apiKey);
        message.Headers.Add("anthropic-version", ApiVersion);
    }

    private static string ExtractDelta(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;

            return root.TryGetProperty("type", out var type)
                && type.GetString() == "content_block_delta"
                && root.TryGetProperty("delta", out var delta)
                && delta.TryGetProperty("text", out var text)
                ? text.GetString() ?? string.Empty
                : string.Empty;
        }
        catch (JsonException)
        {
            return string.Empty;
        }
    }

    private static async Task EnsureAnsweredAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        if (!response.IsSuccessStatusCode)
        {
            throw new InvalidOperationException(await ReadFailureAsync(response, cancellationToken));
        }
    }

    private static async Task<string> ReadFailureAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        var detail = ExtractError(body);
        var status = (int)response.StatusCode;

        return status switch
        {
            401 or 403 => $"Anthropic rechazó la clave ({status}). {detail}".TrimEnd(),
            404 => $"Anthropic no encontró esa ruta o modelo ({status}). {detail}".TrimEnd(),
            429 => $"Anthropic está limitando las peticiones ({status}). {detail}".TrimEnd(),
            _ => $"Anthropic respondió {status}. {detail}".TrimEnd(),
        };
    }

    private static string ExtractError(string body)
    {
        try
        {
            using var document = JsonDocument.Parse(body);

            if (document.RootElement.TryGetProperty("error", out var error)
                && error.TryGetProperty("message", out var message))
            {
                return message.GetString() ?? string.Empty;
            }
        }
        catch (JsonException)
        {
            // El cuerpo en crudo sigue siendo más útil que ocultarlo.
        }

        return body.Length > 200 ? body[..200] : body;
    }
}
