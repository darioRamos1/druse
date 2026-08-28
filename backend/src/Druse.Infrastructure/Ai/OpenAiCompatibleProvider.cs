using System.Diagnostics;
using System.Net.Http.Headers;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using Druse.Application.Ai;
using Druse.Domain;

namespace Druse.Infrastructure.Ai;

/// <summary>
/// Habla el formato de OpenAI, que es el que habla casi todo el mundo.
///
/// **Esta clase sola cubre la mayoría de los casos**: el MaaS de una empresa
/// —Huawei, Alibaba y compañía exponen este mismo formato—, Ollama y LM Studio
/// en el propio equipo, vLLM, Azure, OpenRouter, Groq y la propia OpenAI. Todos
/// atienden `POST {base}/chat/completions` y devuelven el mismo `text/event-stream`.
/// Lo único que cambia entre ellos es la URL y la clave, y las dos son datos del
/// perfil.
///
/// Es, por tanto, el primer proveedor que se implementa: cualquier otro que se
/// añada después cubrirá menos terreno que este.
/// </summary>
public sealed class OpenAiCompatibleProvider(HttpClient http) : IAiProvider
{
    /// <summary>
    /// Lo que precede a cada trozo dentro del flujo de eventos.
    ///
    /// El formato es el de *server-sent events*: líneas `data: {...}`, una por
    /// trozo, y un `data: [DONE]` al final.
    /// </summary>
    private const string DataPrefix = "data:";

    private const string DoneMarker = "[DONE]";

    private readonly HttpClient _http = http;

    public AiProviderKind Kind => AiProviderKind.OpenAiCompatible;

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

        // El final se detecta por la línea nula y no por `EndOfStream`, que
        // bloquea el hilo para saber si queda algo por leer —justo lo que no
        // puede hacerse mientras se espera a un servidor remoto—.
        while (await reader.ReadLineAsync(cancellationToken) is { } line)
        {
            /*
             * Las líneas en blanco separan eventos y los comentarios empiezan por
             * dos puntos. Los dos hay que saltarlos: algunos proveedores mandan
             * comentarios cada pocos segundos para que la conexión no se caiga
             * por inactividad, y tratarlos como datos rompería el análisis.
             */
            if (line.Length == 0 || !line.StartsWith(DataPrefix, StringComparison.Ordinal))
            {
                continue;
            }

            var payload = line[DataPrefix.Length..].Trim();

            if (payload.Length == 0 || payload == DoneMarker)
            {
                if (payload == DoneMarker)
                {
                    yield break;
                }

                continue;
            }

            var text = ExtractDelta(payload);

            if (text.Length > 0)
            {
                yield return new AiChunk(text);
            }
        }
    }

    /// <summary>
    /// Los modelos desplegados, tal y como los nombra el proveedor.
    ///
    /// El formato de OpenAI define `GET /models` junto al de conversación, y lo
    /// atienden tanto los MaaS de empresa como Ollama. Un proveedor que no lo
    /// tenga devuelve un error; aquí eso es una lista vacía y no una excepción,
    /// porque el campo se puede escribir a mano igualmente.
    /// </summary>
    public async Task<IReadOnlyList<string>> ListModelsAsync(
        AiRequest request,
        CancellationToken cancellationToken)
    {
        using var message = new HttpRequestMessage(
            HttpMethod.Get,
            $"{request.Profile.BaseUrl.TrimEnd('/')}/models");

        if (!string.IsNullOrWhiteSpace(request.ApiKey))
        {
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", request.ApiKey);
        }

        HttpResponseMessage response;

        try
        {
            response = await _http.SendAsync(message, cancellationToken);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            // Un fallo de red aquí es el mismo que tendría la conversación, y con
            // el mismo motivo: se traduce igual en vez de dejar el mensaje crudo
            // de .NET, que remite a una excepción que nadie puede mirar.
            throw new InvalidOperationException(Explain(error), error);
        }

        using (response)
        {
            if (!response.IsSuccessStatusCode)
            {
                throw new InvalidOperationException(await ReadFailureAsync(response, cancellationToken));
            }

            return await ReadModelsAsync(response, cancellationToken);
        }
    }

    private static async Task<IReadOnlyList<string>> ReadModelsAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {

        using var document = JsonDocument.Parse(
            await response.Content.ReadAsStringAsync(cancellationToken));

        if (!document.RootElement.TryGetProperty("data", out var data)
            || data.ValueKind != JsonValueKind.Array)
        {
            return [];
        }

        return [.. data
            .EnumerateArray()
            .Select(model => model.TryGetProperty("id", out var id) ? id.GetString() : null)
            .Where(id => !string.IsNullOrWhiteSpace(id))
            .Select(id => id!)
            .Order(StringComparer.OrdinalIgnoreCase)];
    }

    public async Task<AiProbe> ProbeAsync(AiRequest request, CancellationToken cancellationToken)
    {
        var clock = Stopwatch.StartNew();

        try
        {
            // Sin streaming y con el techo más bajo que acepta el formato: lo que
            // se comprueba es que contesta, no qué contesta, y una respuesta
            // larga aquí solo costaría dinero y segundos.
            using var message = BuildRequest(request, stream: false, maxTokens: 1);
            using var response = await _http.SendAsync(message, cancellationToken);

            clock.Stop();

            if (response.IsSuccessStatusCode)
            {
                return new AiProbe(true, $"{request.Profile.Model} respondió.", clock.ElapsedMilliseconds);
            }

            var detail = await ReadFailureAsync(response, cancellationToken);

            return new AiProbe(false, detail, clock.ElapsedMilliseconds);
        }
        catch (Exception error) when (error is HttpRequestException or TaskCanceledException)
        {
            clock.Stop();

            return new AiProbe(false, Explain(error), clock.ElapsedMilliseconds);
        }
    }

    /// <summary>
    /// Compone la petición: cuerpo, cabeceras y la URL ya unida.
    /// </summary>
    private static HttpRequestMessage BuildRequest(AiRequest request, bool stream, int? maxTokens)
    {
        var payload = new Dictionary<string, object>
        {
            ["model"] = request.Profile.Model,
            ["stream"] = stream,
            ["messages"] = request.Messages
                .Select(message => new Dictionary<string, string>
                {
                    ["role"] = RoleName(message.Role),
                    ["content"] = message.Text,
                })
                .ToArray(),
        };

        if (maxTokens is { } techo)
        {
            payload["max_tokens"] = techo;
        }

        var message = new HttpRequestMessage(HttpMethod.Post, Endpoint(request.Profile.BaseUrl))
        {
            Content = new StringContent(
                JsonSerializer.Serialize(payload),
                Encoding.UTF8,
                "application/json"),
        };

        // Ollama y LM Studio no piden clave, así que mandar la cabecera vacía
        // sería mandar `Bearer ` a secas: algunos servidores lo rechazan.
        if (!string.IsNullOrWhiteSpace(request.ApiKey))
        {
            message.Headers.Authorization = new AuthenticationHeaderValue("Bearer", request.ApiKey);
        }

        return message;
    }

    /// <summary>
    /// Une la URL base con la ruta, sobre el número de barras que traiga.
    ///
    /// El validador ya rechaza una base que incluya la ruta; lo que queda aquí es
    /// el detalle de si el usuario dejó o no la barra final, que no debería
    /// producir una URL con dos.
    /// </summary>
    private static string Endpoint(string baseUrl) =>
        $"{baseUrl.TrimEnd('/')}/chat/completions";

    private static string RoleName(AiRole role) => role switch
    {
        AiRole.System => "system",
        AiRole.Assistant => "assistant",
        _ => "user",
    };

    /// <summary>
    /// Saca el texto nuevo de un trozo, si lo trae.
    ///
    /// Un trozo puede no traer texto —el primero suele anunciar solo el papel de
    /// quien habla, y el último el motivo de la parada—, y eso no es un error.
    /// Tampoco lo es un trozo que no se entienda: cortar el flujo entero por una
    /// línea rara perdería la respuesta que ya iba escrita.
    /// </summary>
    private static string ExtractDelta(string payload)
    {
        try
        {
            using var document = JsonDocument.Parse(payload);

            if (!document.RootElement.TryGetProperty("choices", out var choices)
                || choices.GetArrayLength() == 0)
            {
                return string.Empty;
            }

            var first = choices[0];

            if (first.TryGetProperty("delta", out var delta)
                && delta.TryGetProperty("content", out var content)
                && content.ValueKind == JsonValueKind.String)
            {
                return content.GetString() ?? string.Empty;
            }

            return string.Empty;
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
        if (response.IsSuccessStatusCode)
        {
            return;
        }

        throw new InvalidOperationException(await ReadFailureAsync(response, cancellationToken));
    }

    /// <summary>
    /// Convierte el fallo del proveedor en algo que se pueda leer en pantalla.
    ///
    /// El cuerpo de un error suele traer el motivo real —clave inválida, modelo
    /// que no existe, cuota agotada—, y enseñar solo «500» esconde justo el dato
    /// que resuelve el problema.
    /// </summary>
    private static async Task<string> ReadFailureAsync(
        HttpResponseMessage response,
        CancellationToken cancellationToken)
    {
        var body = await response.Content.ReadAsStringAsync(cancellationToken);
        var motivo = ExtractErrorMessage(body);
        var codigo = (int)response.StatusCode;

        return codigo switch
        {
            401 or 403 => $"El proveedor rechazó la clave ({codigo}). {motivo}".TrimEnd(),
            404 => $"No existe esa ruta o ese modelo ({codigo}). {motivo}".TrimEnd(),
            429 => $"El proveedor está limitando las peticiones ({codigo}). {motivo}".TrimEnd(),
            _ => $"El proveedor respondió {codigo}. {motivo}".TrimEnd(),
        };
    }

    private static string ExtractErrorMessage(string body)
    {
        if (string.IsNullOrWhiteSpace(body))
        {
            return string.Empty;
        }

        try
        {
            using var document = JsonDocument.Parse(body);

            if (document.RootElement.TryGetProperty("error", out var error))
            {
                if (error.ValueKind == JsonValueKind.String)
                {
                    return error.GetString() ?? string.Empty;
                }

                if (error.TryGetProperty("message", out var message)
                    && message.ValueKind == JsonValueKind.String)
                {
                    return message.GetString() ?? string.Empty;
                }
            }
        }
        catch (JsonException)
        {
            // No era JSON. El cuerpo en crudo sigue diciendo más que nada, pero
            // recortado: un HTML de error entero no cabe en un mensaje.
        }

        return body.Length > 200 ? body[..200] : body;
    }

    /// <summary>
    /// Traduce el fallo de red a algo accionable, **con su causa de dentro**.
    ///
    /// Lo que .NET pone en el mensaje de arriba suele ser inútil por sí solo: «The
    /// SSL connection could not be established, see inner exception» le dice a
    /// quien lo lee que mire un sitio al que no tiene acceso. El motivo de verdad
    /// —el certificado que no valida, el nombre que no coincide, el proxy que
    /// corta— está en las excepciones interiores, así que se sacan y se enseñan.
    /// </summary>
    private static string Explain(Exception error)
    {
        var causa = Innermost(error);

        return error switch
        {
            TaskCanceledException => "El proveedor no respondió a tiempo.",
            _ when error.Message.Contains("No such host", StringComparison.OrdinalIgnoreCase)
                => "No se encontró ese servidor. Revisa la URL base.",
            _ when error.Message.Contains("actively refused", StringComparison.OrdinalIgnoreCase)
                => "Nadie escucha en esa dirección. Si es una IA local, ¿está arrancada?",
            /*
             * «Frame» corrupto es casi siempre el mismo error de una letra: se
             * habla TLS a un puerto que sirve texto plano. Decir «no se pudo
             * cifrar» manda a mirar certificados; lo que hay que cambiar es la
             * `s` de la URL.
             */
            _ when causa.Contains("frame", StringComparison.OrdinalIgnoreCase)
                => "Ese servidor no habla cifrado en ese puerto. Prueba con http:// en vez de https://.",
            _ when error.Message.Contains("SSL", StringComparison.OrdinalIgnoreCase)
                => $"No se pudo cifrar la conexión: {causa}",
            _ => causa,
        };
    }

    /// <summary>El mensaje más interior, que es donde está el motivo de verdad.</summary>
    private static string Innermost(Exception error)
    {
        var actual = error;

        while (actual.InnerException is { } inner)
        {
            actual = inner;
        }

        return actual.Message;
    }
}
