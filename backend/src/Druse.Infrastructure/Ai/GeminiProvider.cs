using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Druse.Application.Ai;
using Druse.Domain;

namespace Druse.Infrastructure.Ai;

/// <summary>Habla con la API nativa generateContent de Google Gemini.</summary>
public sealed class GeminiProvider(HttpClient http) : IAiProvider
{
    private readonly HttpClient _http = http;

    public AiProviderKind Kind => AiProviderKind.Gemini;

    public async IAsyncEnumerable<AiChunk> StreamAsync(
        AiRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        using var message = BuildRequest(request, stream: true, maxTokens: null);
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

            var text = ExtractText(line["data:".Length..].Trim());

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
        AddKey(message, request.ApiKey);

        using var response = await _http.SendAsync(message, cancellationToken);
        await EnsureAnsweredAsync(response, cancellationToken);
        using var document = JsonDocument.Parse(
            await response.Content.ReadAsStringAsync(cancellationToken));

        if (!document.RootElement.TryGetProperty("models", out var models)
            || models.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return [.. models
            .EnumerateArray()
            .Where(SupportsGenerateContent)
            .Select(item => item.TryGetProperty("name", out var name) ? name.GetString() : null)
            .Where(name => !string.IsNullOrWhiteSpace(name))
            .Select(name => name!.StartsWith("models/", StringComparison.Ordinal) ? name["models/".Length..] : name)
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

    private static HttpRequestMessage BuildRequest(AiRequest request, bool stream, int? maxTokens)
    {
        var system = string.Join(
            "\n\n",
            request.Messages.Where(message => message.Role == AiRole.System).Select(message => message.Text));
        var payload = new Dictionary<string, object>
        {
            ["contents"] = request.Messages
                .Where(message => message.Role != AiRole.System)
                .Select(message => new
                {
                    role = message.Role == AiRole.Assistant ? "model" : "user",
                    parts = new[] { new { text = message.Text } },
                })
                .ToArray(),
        };

        if (system.Length > 0)
        {
            payload["systemInstruction"] = new { parts = new[] { new { text = system } } };
        }

        if (maxTokens is { } limit)
        {
            payload["generationConfig"] = new { maxOutputTokens = limit };
        }

        var method = stream ? "streamGenerateContent?alt=sse" : "generateContent";
        var model = request.Profile.Model.StartsWith("models/", StringComparison.Ordinal)
            ? request.Profile.Model["models/".Length..]
            : request.Profile.Model;
        var message = new HttpRequestMessage(
            HttpMethod.Post,
            $"{request.Profile.BaseUrl.TrimEnd('/')}/models/{Uri.EscapeDataString(model)}:{method}")
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json"),
        };
        AddKey(message, request.ApiKey);

        return message;
    }

    private static void AddKey(HttpRequestMessage message, string? apiKey)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
        {
            throw new InvalidOperationException("Falta la clave API de Google Gemini.");
        }

        message.Headers.Add("x-goog-api-key", apiKey);
    }

    private static bool SupportsGenerateContent(JsonElement model)
    {
        if (!model.TryGetProperty("supportedGenerationMethods", out var methods)
            || methods.ValueKind != JsonValueKind.Array)
        {
            return true;
        }

        return methods.EnumerateArray().Any(method => method.GetString() == "generateContent");
    }

    private static string ExtractText(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);
            var root = document.RootElement;

            if (!root.TryGetProperty("candidates", out var candidates)
                || candidates.GetArrayLength() == 0
                || !candidates[0].TryGetProperty("content", out var content)
                || !content.TryGetProperty("parts", out var parts))
            {
                return string.Empty;
            }

            return string.Concat(parts
                .EnumerateArray()
                .Select(part => part.TryGetProperty("text", out var text) ? text.GetString() : null));
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
            400 => $"Gemini rechazó la petición ({status}). {detail}".TrimEnd(),
            401 or 403 => $"Gemini rechazó la clave ({status}). {detail}".TrimEnd(),
            404 => $"Gemini no encontró ese modelo ({status}). {detail}".TrimEnd(),
            429 => $"Gemini está limitando las peticiones ({status}). {detail}".TrimEnd(),
            _ => $"Gemini respondió {status}. {detail}".TrimEnd(),
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
