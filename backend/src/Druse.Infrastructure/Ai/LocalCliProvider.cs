using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using Druse.Application.Ai;
using Druse.Domain;

namespace Druse.Infrastructure.Ai;

/// <summary>
/// Habla con un programa de consola ya instalado y con sesión iniciada.
///
/// **Es lo que permite usar una suscripción personal.** Ni Claude Pro ni ChatGPT
/// Plus entregan credenciales que una aplicación de terceros pueda usar: no
/// existe tal cosa. Lo que sí existe es el programa oficial de cada uno —`claude`
/// y `codex`—, que ya sabe quién es su dueño porque él inició sesión. Druse le
/// pregunta a ese programa y reenvía lo que responda.
///
/// A cambio de no pedir credenciales, hereda dos límites que conviene tener
/// presentes: solo funciona donde el programa esté instalado, y su formato de
/// salida no es un contrato con versión, así que una actualización del programa
/// puede cambiarlo. Por eso vive detrás de <see cref="IAiProvider"/> como los
/// demás: el día que cambie, cambia esta clase y nada más.
/// </summary>
public sealed class LocalCliProvider : IAiProvider
{
    /// <summary>
    /// Herramientas que el asistente no puede usar.
    ///
    /// **No es una precaución de más.** `claude` y `codex` son agentes de
    /// programación: por omisión leen y escriben archivos y ejecutan órdenes. Un
    /// chat que ayuda con SQL no necesita nada de eso, y dejárselo sería darle
    /// permiso sobre el disco de quien pregunta. `--restricted` ya quita las que
    /// ejecutan código; esto quita las que tocan archivos y las que salen a la
    /// red.
    /// </summary>
    private const string Forbidden =
        "Edit Write NotebookEdit Task Read Glob Grep WebSearch WebFetch";

    public AiProviderKind Kind => AiProviderKind.LocalCli;

    public async IAsyncEnumerable<AiChunk> StreamAsync(
        AiRequest request,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        using var process = Start(request);

        /*
         * Las líneas se pasan por un canal en vez de leerse en el bucle.
         *
         * `ReadLineAsync` sobre la salida de un proceso no atiende al token de
         * cancelación: quien cancela se quedaría esperando a que el programa
         * decida escribir algo. Con el canal, el evento de salida va por su
         * cuenta y el bucle solo espera al canal, que sí se cancela.
         */
        var lines = Channel.CreateUnbounded<string>();
        var errors = new StringBuilder();

        process.OutputDataReceived += (_, args) =>
        {
            if (args.Data is null)
            {
                lines.Writer.TryComplete();
            }
            else
            {
                lines.Writer.TryWrite(args.Data);
            }
        };

        process.ErrorDataReceived += (_, args) =>
        {
            if (args.Data is not null)
            {
                errors.AppendLine(args.Data);
            }
        };

        process.Start();
        process.BeginOutputReadLine();
        process.BeginErrorReadLine();

        // La conversación entera va por la entrada estándar y no como argumento:
        // una pregunta larga con el esquema dentro no cabe en una línea de
        // órdenes, y en Windows se cortaría sin decir por qué.
        await process.StandardInput.WriteAsync(Prompt(request.Messages));
        await process.StandardInput.FlushAsync(cancellationToken);
        process.StandardInput.Close();

        string? failure = null;

        try
        {
            await foreach (var line in lines.Reader.ReadAllAsync(cancellationToken))
            {
                var (text, error) = Interpret(request.Profile.Command, line);

                if (error is not null)
                {
                    failure = error;

                    break;
                }

                if (text.Length > 0)
                {
                    yield return new AiChunk(text);
                }
            }
        }
        finally
        {
            Stop(process);
        }

        if (failure is not null)
        {
            throw new InvalidOperationException(failure);
        }

        // Un programa que muere sin escribir nada útil deja al usuario mirando
        // un turno vacío: lo que dijo por el canal de errores es lo único que
        // explica por qué.
        if (process.ExitCode != 0 && errors.Length > 0)
        {
            throw new InvalidOperationException(Explain(request.Profile.Command, errors.ToString()));
        }
    }

    /// <summary>
    /// Codex conserva el catálogo que recibió para la cuenta autenticada.
    ///
    /// No se usa una lista escrita en Druse: el archivo incluye visibilidad y
    /// prioridad y se actualiza cuando Codex habla con OpenAI. Claude no expone
    /// un catálogo equivalente, por lo que sigue usando sus alias conocidos.
    /// </summary>
    public async Task<IReadOnlyList<string>> ListModelsAsync(
        AiRequest request,
        CancellationToken cancellationToken)
    {
        if (!request.Profile.Command.Equals("codex", StringComparison.OrdinalIgnoreCase))
        {
            return [];
        }

        var home = request.SessionDirectory
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".codex");
        var cache = Path.Combine(home, "models_cache.json");

        if (!File.Exists(cache))
        {
            return [];
        }

        try
        {
            await using var stream = File.OpenRead(cache);
            using var document = await JsonDocument.ParseAsync(stream, cancellationToken: cancellationToken);

            if (!document.RootElement.TryGetProperty("models", out var models)
                || models.ValueKind != JsonValueKind.Array)
            {
                return [];
            }

            return [.. models
                .EnumerateArray()
                .Where(model => Text(model, "visibility") == "list")
                .Select(model => new
                {
                    Slug = Text(model, "slug"),
                    Priority = model.TryGetProperty("priority", out var priority)
                        && priority.TryGetInt32(out var value)
                            ? value
                            : int.MaxValue,
                })
                .Where(model => !string.IsNullOrWhiteSpace(model.Slug))
                .OrderBy(model => model.Priority)
                .ThenBy(model => model.Slug, StringComparer.OrdinalIgnoreCase)
                .Select(model => model.Slug!)];
        }
        catch (JsonException)
        {
            // Codex puede estar reemplazando la caché mientras se lee. El campo
            // sigue aceptando texto y una recarga posterior volverá a intentarlo.
            return [];
        }
    }

    /// <summary>
    /// Comprueba que el programa está y responde, **sin gastar cuota**.
    ///
    /// Se le pide la versión y no una respuesta: probar un proveedor no puede
    /// costarle al usuario parte del uso que tiene contratado, y lo que hay que
    /// averiguar aquí —si el binario existe y arranca— se sabe igual.
    /// </summary>
    public async Task<AiProbe> ProbeAsync(AiRequest request, CancellationToken cancellationToken)
    {
        var clock = Stopwatch.StartNew();

        try
        {
            using var process = new Process
            {
                StartInfo = VersionCheck(request.Profile.Command),
            };

            process.Start();

            var version = (await process.StandardOutput.ReadToEndAsync(cancellationToken)).Trim();

            await process.WaitForExitAsync(cancellationToken);
            clock.Stop();

            if (process.ExitCode != 0)
            {
                return new AiProbe(
                    false,
                    $"«{request.Profile.Command}» respondió con un error.",
                    clock.ElapsedMilliseconds);
            }

            return new AiProbe(
                true,
                version.Length > 0 ? version : $"«{request.Profile.Command}» responde.",
                clock.ElapsedMilliseconds);
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            clock.Stop();

            return new AiProbe(
                false,
                $"No se encontró «{request.Profile.Command}» en este equipo. ¿Está instalado?",
                clock.ElapsedMilliseconds);
        }
    }

    /// <summary>Como se le pregunta la version, resolviendo antes su ruta real.</summary>
    private static ProcessStartInfo VersionCheck(string command)
    {
        var path = CliPath.Find(command)
            ?? throw new InvalidOperationException($"No se encontro «{command}».");
        var shell = CliPath.NeedsShell(path);

        var info = new ProcessStartInfo(shell ? "cmd.exe" : path)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
        };

        if (shell)
        {
            info.ArgumentList.Add("/c");
            info.ArgumentList.Add(path);
        }

        info.ArgumentList.Add("--version");

        return info;
    }

    /// <summary>
    /// Arma la orden con la que se le habla al programa.
    ///
    /// Los argumentos los pone Druse y no el usuario: de ellos depende que el
    /// asistente no pueda tocar el disco, y un campo de texto donde escribirlos
    /// sería un campo donde quitarlos.
    /// </summary>
    private static Process Start(AiRequest request)
    {
        // El programa se busca en el PATH como lo haria una consola: en Windows
        // los de npm son `.cmd`, y `Process.Start` a secas no los encuentra.
        var path = CliPath.Find(request.Profile.Command)
            ?? throw new InvalidOperationException(
                $"No se encontro «{request.Profile.Command}» en este equipo.");
        var shell = CliPath.NeedsShell(path);

        var info = new ProcessStartInfo(shell ? "cmd.exe" : path)
        {
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            StandardOutputEncoding = Encoding.UTF8,

            // Fuera del proyecto: sin esto, el programa leería los archivos de
            // instrucciones del repositorio donde esté Druse y respondería con
            // ellos en la cabeza.
            WorkingDirectory = Path.GetTempPath(),
        };

        // Con cuenta propia, el programa busca sus credenciales donde le diga
        // Druse y no en la sesión del equipo: es lo que permite preguntar con
        // una cuenta distinta de la que usa quien programa con esta herramienta.
        if (request.SessionDirectory is { } home)
        {
            Directory.CreateDirectory(home);
            info.EnvironmentVariables[CliPath.SessionVariable(request.Profile.Command)] = home;
        }

        if (shell)
        {
            info.ArgumentList.Add("/c");
            info.ArgumentList.Add(path);
        }

        foreach (var argument in Arguments(request))
        {
            info.ArgumentList.Add(argument);
        }

        return new Process { StartInfo = info };
    }

    private static IEnumerable<string> Arguments(AiRequest request)
    {
        if (request.Profile.Command == "codex")
        {
            yield return "exec";
            yield return "--json";
            yield return "--ephemeral";
            yield return "--sandbox";
            yield return "read-only";
            yield return "--skip-git-repo-check";

            if (request.Profile.Model.Length > 0)
            {
                yield return "--model";
                yield return request.Profile.Model;
            }

            // Un guion hace que Codex lea el prompt de stdin, donde también cabe
            // el esquema completo sin topar con el límite de la línea de órdenes.
            yield return "-";
            yield break;
        }

        yield return "-p";
        yield return "--output-format";
        yield return "stream-json";

        // El formato en trozos lo exige, y sin él el programa se niega a arrancar.
        yield return "--verbose";
        yield return "--include-partial-messages";

        // Quita las herramientas que ejecutan órdenes; las que tocan archivos se
        // quitan aparte porque `--restricted` no las cubre.
        yield return "--restricted";
        yield return "--disallowed-tools";
        yield return Forbidden;

        // Sin servidores externos: el asistente responde sobre lo que se le
        // cuenta, no sobre lo que pueda ir a buscar.
        yield return "--strict-mcp-config";

        if (request.Profile.Model.Length > 0)
        {
            yield return "--model";
            yield return request.Profile.Model;
        }
    }

    /// <summary>
    /// Aplana la conversación en un solo texto.
    ///
    /// El programa se invoca una vez por pregunta y no guarda el hilo, así que
    /// el hilo se lo cuenta Druse. Las instrucciones van primero y marcadas,
    /// para que se distingan de lo que escribió la persona.
    /// </summary>
    private static string Prompt(IReadOnlyList<AiMessage> messages)
    {
        var texto = new StringBuilder();

        foreach (var message in messages)
        {
            var quien = message.Role switch
            {
                AiRole.System => "[Instrucciones]",
                AiRole.Assistant => "[Asistente]",
                _ => "[Usuario]",
            };

            texto.Append(quien).Append('\n').Append(message.Text).Append("\n\n");
        }

        return texto.ToString();
    }

    /// <summary>
    /// Saca de una línea el texto nuevo, o el fallo si lo hubo.
    ///
    /// Cada línea es un JSON suelto. Interesan dos: el trozo de texto según se
    /// escribe, y el resumen final —que es donde el programa dice si la cosa
    /// acabó mal—. Todo lo demás es contabilidad suya.
    /// </summary>
    private static (string Text, string? Error) Interpret(string command, string line)
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

            if (command == "codex")
            {
                if (type == "item.completed"
                    && root.TryGetProperty("item", out var item)
                    && item.TryGetProperty("type", out var itemType)
                    && itemType.GetString() == "agent_message"
                    && item.TryGetProperty("text", out var codexText))
                {
                    return (codexText.GetString() ?? string.Empty, null);
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
        catch (JsonException)
        {
            // Una línea que no se entiende no puede llevarse por delante lo que
            // ya se escribió.
            return (string.Empty, null);
        }
    }

    /// <summary>Cierra el programa si sigue vivo, que es lo que pasa al cancelar.</summary>
    private static void Stop(Process process)
    {
        try
        {
            if (!process.HasExited)
            {
                process.Kill(entireProcessTree: true);
            }
            else
            {
                return;
            }

            process.WaitForExit(2000);
        }
        catch (InvalidOperationException)
        {
            // Ya no existe. No hay nada que cerrar.
        }
    }

    private static string Explain(string command, string errors)
    {
        var primera = errors
            .Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .FirstOrDefault() ?? string.Empty;

        // Sin sesión iniciada el programa lo dice a su manera; traducirlo evita
        // que el usuario busque el problema en Druse.
        if (primera.Contains("login", StringComparison.OrdinalIgnoreCase)
            || primera.Contains("authenticat", StringComparison.OrdinalIgnoreCase))
        {
            return $"«{command}» no tiene sesión iniciada. Ábrelo una vez y entra con tu cuenta.";
        }

        return primera.Length > 0 ? primera : $"«{command}» terminó sin responder.";
    }

    private static string? Text(JsonElement element, string property) =>
        element.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;
}
