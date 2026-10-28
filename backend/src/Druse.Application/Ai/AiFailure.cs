using System.Net;
using System.Text.Json;

namespace Druse.Application.Ai;

/// <summary>El motivo legible y el detalle original se conservan por separado.</summary>
public sealed record AiFailure(string Code, string Message, string Detail)
{
    public static AiFailure From(Exception error, string? apiKey = null)
    {
        var detail = error is AiProviderException provider ? provider.TechnicalDetail : error.Message;
        if (!string.IsNullOrEmpty(apiKey))
        {
            detail = detail.Replace(apiKey, "[clave omitida]", StringComparison.Ordinal);
        }
        var message = ReadMessage(detail);
        var text = detail.ToLowerInvariant();
        var status = (error as HttpRequestException)?.StatusCode;
        var code = text.Contains("model", StringComparison.Ordinal) &&
            (text.Contains("not supported", StringComparison.Ordinal) || text.Contains("unsupported", StringComparison.Ordinal) || text.Contains("model_not_found", StringComparison.Ordinal) || text.Contains("model does not exist", StringComparison.Ordinal))
            ? "unsupportedModel"
            : status == HttpStatusCode.TooManyRequests || text.Contains("429", StringComparison.Ordinal) || text.Contains("quota", StringComparison.Ordinal) || text.Contains("rate limit", StringComparison.Ordinal) || text.Contains("credit balance", StringComparison.Ordinal)
            ? "quota"
            : status is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden || text.Contains("401", StringComparison.Ordinal) || text.Contains("403", StringComparison.Ordinal) || text.Contains("not logged", StringComparison.Ordinal) || text.Contains("authentication", StringComparison.Ordinal) || text.Contains("sin sesión", StringComparison.Ordinal) || text.Contains("rechazó la clave", StringComparison.Ordinal)
            ? "authentication"
            : error is HttpRequestException or TaskCanceledException || error.InnerException is HttpRequestException or TaskCanceledException || text.Contains("network", StringComparison.Ordinal) || text.Contains("connection refused", StringComparison.Ordinal) || text.Contains("timed out", StringComparison.Ordinal) || text.Contains("no respondió a tiempo", StringComparison.Ordinal)
            ? "network"
            : "other";
        return new AiFailure(code, message, detail);
    }

    /// <summary>Codex puede encapsular otro JSON dentro del campo message.</summary>
    public static string ReadMessage(string text)
    {
        var current = text.Trim();
        for (var depth = 0; depth < 6; depth++)
        {
            try
            {
                using var document = JsonDocument.Parse(current);
                var root = document.RootElement;
                if (root.ValueKind == JsonValueKind.String)
                {
                    current = root.GetString() ?? current;
                    continue;
                }
                if (root.ValueKind != JsonValueKind.Object)
                {
                    break;
                }
                if (root.TryGetProperty("error", out var error) && error.ValueKind is JsonValueKind.Object or JsonValueKind.String)
                {
                    current = error.ValueKind == JsonValueKind.String ? error.GetString()! : error.GetRawText();
                }
                else if (root.TryGetProperty("message", out var message) && message.ValueKind == JsonValueKind.String)
                {
                    current = message.GetString()!;
                }
                else
                {
                    break;
                }
            }
            catch (JsonException)
            {
                break;
            }
        }
        return current;
    }
}

/// <summary>Permite copiar el error original sin usarlo como texto principal.</summary>
public sealed class AiProviderException(string message, string technicalDetail) : InvalidOperationException(message)
{
    public string TechnicalDetail { get; } = technicalDetail;
}
