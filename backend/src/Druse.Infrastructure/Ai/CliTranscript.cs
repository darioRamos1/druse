using System.Text.Json;

namespace Druse.Infrastructure.Ai;

/// <summary>
/// Va sacando de cada línea el texto nuevo, o el fallo si lo hubo.
///
/// Cada línea es un JSON suelto. Interesan dos: el trozo de texto según se
/// escribe y el resumen final —que es donde el programa dice si la cosa
/// acabó mal—. Todo lo demás es contabilidad suya.
///
/// **Lleva cuenta de lo ya entregado**, y esa es toda la razón de que sea un
/// objeto y no una función. Claude manda su respuesta en trozos que se
/// concatenan; Codex la manda entera de una vez, y si algún día manda además
/// avances parciales del mismo mensaje, sumarlos sin más escribiría el texto
/// dos veces. Guardando lo entregado por cada mensaje se emite solo lo que
/// falta, y las dos formas caben sin que ninguna estorbe a la otra.
/// </summary>
internal sealed class CliTranscript(string command)
{
    /// <summary>Cuánto se lleva entregado de cada mensaje, por su identificador.</summary>
    private readonly Dictionary<string, int> _delivered = [];

    private readonly bool _codex = LocalCliProvider.IsCodex(command);

    public (string Text, string? Error) Read(string line)
    {
        if (line.Length == 0 || line[0] != '{')
        {
            return (string.Empty, null);
        }

        try
        {
            using var document = JsonDocument.Parse(line);
            var root = document.RootElement;
            var type = root.TryGetProperty("type", out var kind) ? kind.GetString() : null;

            return _codex ? Codex(root, type) : Claude(root, type);
        }
        catch (JsonException)
        {
            // Una línea que no se entiende no puede llevarse por delante lo
            // que ya se escribió.
            return (string.Empty, null);
        }
    }

    /// <summary>
    /// Lo que dice `codex exec --json`, que son eventos por mensaje.
    ///
    /// Se atienden los dos que traen texto del asistente. Hoy —comprobado
    /// contra `codex-cli 0.150.1`— solo llega `item.completed`, con la
    /// respuesta entera al final; `item.updated` existe en el programa pero
    /// no lo emite para estos mensajes. Se lee igual porque el día que lo
    /// haga, el texto aparecerá según se escribe sin tocar nada aquí.
    /// </summary>
    private (string Text, string? Error) Codex(JsonElement root, string? type)
    {
        if (type is "item.updated" or "item.completed"
            && root.TryGetProperty("item", out var item)
            && item.TryGetProperty("type", out var itemType)
            && itemType.GetString() == "agent_message"
            && item.TryGetProperty("text", out var text))
        {
            return (Fresh(Id(item), text.GetString() ?? string.Empty), null);
        }

        if (type is "turn.failed" or "error")
        {
            var detail = root.TryGetProperty("message", out var message)
                ? message.GetString()
                : root.TryGetProperty("error", out var error)
                    && error.ValueKind == JsonValueKind.Object
                    && error.TryGetProperty("message", out var nested)
                    ? nested.GetString()
                    : null;

            return (string.Empty, detail ?? "Codex terminó con un error.");
        }

        return (string.Empty, null);
    }

    /// <summary>Lo que dice `claude -p --output-format stream-json`.</summary>
    private static (string Text, string? Error) Claude(JsonElement root, string? type)
    {
        if (type == "stream_event"
            && root.TryGetProperty("event", out var evento)
            && evento.TryGetProperty("type", out var eventType)
            && eventType.GetString() == "content_block_delta"
            && evento.TryGetProperty("delta", out var delta)
            && delta.TryGetProperty("text", out var text))
        {
            return (text.GetString() ?? string.Empty, null);
        }

        if (type == "result"
            && root.TryGetProperty("is_error", out var isError)
            && isError.ValueKind == JsonValueKind.True)
        {
            var detalle = root.TryGetProperty("result", out var result)
                ? result.GetString()
                : null;

            return (string.Empty, detalle ?? "El programa terminó con un error.");
        }

        return (string.Empty, null);
    }

    /// <summary>
    /// La parte de este mensaje que todavía no se ha entregado.
    ///
    /// Un mensaje que llega dos veces —primero a medias y luego entero— se
    /// recorta por donde se quedó. Si lo que llega es más corto que lo ya
    /// entregado, no es una continuación y no se emite nada: reescribir lo
    /// dicho no es algo que este canal sepa hacer.
    /// </summary>
    private string Fresh(string id, string text)
    {
        var already = _delivered.GetValueOrDefault(id);

        if (text.Length <= already)
        {
            return string.Empty;
        }

        _delivered[id] = text.Length;

        return text[already..];
    }

    /// <summary>
    /// El identificador del mensaje, o uno fijo cuando no lo trae.
    ///
    /// Sin identificador se trata todo como un solo mensaje, que es lo que
    /// es mientras Codex conteste de una vez.
    /// </summary>
    private static string Id(JsonElement item) =>
        item.TryGetProperty("id", out var id) && id.ValueKind == JsonValueKind.String
            ? id.GetString() ?? "item"
            : "item";
}
