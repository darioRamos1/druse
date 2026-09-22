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
public sealed class LocalCliProvider(ICliSession sessions) : IAiProvider
{
    private readonly ICliSession _sessions = sessions;

    /// <summary>
    /// Cuánto puede callarse el programa antes de darlo por colgado.
    ///
    /// No es el tiempo de la respuesta, sino el que pasa **sin escribir nada**.
    /// Antes no había ninguno: el bucle esperaba al canal hasta que el programa
    /// decidiera hablar, y un `claude` que se quedaba pensando dejaba el turno
    /// abierto para siempre, sin texto y sin error, con la única salida de
    /// cerrar Druse.
    ///
    /// Tres minutos porque Codex todavía manda su respuesta de una sola vez, al
    /// final: hasta que llegue no hay nada que contar, y un plazo corto cortaría
    /// respuestas que iban bien.
    /// </summary>
    private static readonly TimeSpan Silence = TimeSpan.FromMinutes(3);

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
        var model = await ModelAsync(request, cancellationToken);

        using var process = Start(request, model);

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
        var reader = new CliTranscript(request.Profile.Command);

        try
        {
            var talking = true;

            while (talking)
            {
                /*
                 * La espera se hace aparte porque aquí no cabe.
                 *
                 * Un `yield return` no puede vivir dentro de un `try` que
                 * atrape excepciones, y distinguir «se calló» de «lo cancelaron»
                 * exige atraparlas: se resuelve fuera y aquí solo llega el
                 * veredicto.
                 */
                switch (await WaitAsync(lines.Reader, cancellationToken))
                {
                    case Wait.Silent:
                        failure = Mute(request.Profile.Command);
                        talking = false;

                        continue;

                    case Wait.Closed:
                        talking = false;

                        continue;
                }

                while (lines.Reader.TryRead(out var line))
                {
                    var (text, error) = reader.Read(line);

                    if (error is not null)
                    {
                        failure = error;
                        talking = false;

                        break;
                    }

                    if (text.Length > 0)
                    {
                        yield return new AiChunk(text);
                    }
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

    /// <summary>Cómo terminó una espera por la siguiente línea.</summary>
    private enum Wait
    {
        /// <summary>Hay algo escrito, listo para leer.</summary>
        Line,

        /// <summary>El programa cerró su salida: no va a decir nada más.</summary>
        Closed,

        /// <summary>Pasó demasiado tiempo sin escribir nada.</summary>
        Silent,
    }

    /// <summary>
    /// Espera a la siguiente línea, sin quedarse esperando para siempre.
    ///
    /// El plazo se cuenta desde la última que llegó, no desde el principio: un
    /// programa que va escribiendo puede tardar lo que necesite, y uno que se
    /// calla se corta al cabo de <see cref="Silence"/>. La cancelación de quien
    /// pregunta sigue su camino y no se confunde con el plazo.
    /// </summary>
    private static async Task<Wait> WaitAsync(
        ChannelReader<string> lines,
        CancellationToken cancellationToken)
    {
        using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        limit.CancelAfter(Silence);

        try
        {
            return await lines.WaitToReadAsync(limit.Token) ? Wait.Line : Wait.Closed;
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return Wait.Silent;
        }
    }

    /// <summary>Lo que se le cuenta a quien esperaba una respuesta que no llegó.</summary>
    private static string Mute(string command) =>
        $"«{command}» dejó de responder: {Silence.TotalMinutes:0} minutos sin escribir nada. "
        + "Se cerró el intento; puedes volver a preguntar.";

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
    /// Comprueba que se puede preguntar de verdad, **sin gastar cuota**.
    ///
    /// Antes solo pedía la versión, y con eso decía que sí a cualquier equipo
    /// donde el programa estuviera instalado —aunque no hubiera sesión iniciada,
    /// que es el caso que más se da—. El usuario veía «conecta bien» y descubría
    /// el problema al mandar la primera pregunta, que es descubrirlo tarde y en
    /// el peor sitio.
    ///
    /// Ahora se mira lo mismo que mira el diálogo: si el programa está, si tiene
    /// sesión y con qué modelo va a hablar. Ninguna de las tres preguntas cuesta
    /// nada: son locales, y probar un proveedor no puede consumir parte del uso
    /// que el usuario tiene contratado.
    /// </summary>
    public async Task<AiProbe> ProbeAsync(AiRequest request, CancellationToken cancellationToken)
    {
        var command = request.Profile.Command;
        var clock = Stopwatch.StartNew();
        var state = await _sessions.InspectAsync(
            command,
            request.SessionDirectory,
            cancellationToken);

        if (!state.Installed)
        {
            clock.Stop();

            return new AiProbe(
                false,
                $"No se encontró «{command}» en este equipo. ¿Está instalado?",
                clock.ElapsedMilliseconds);
        }

        if (state.LoggedIn == false)
        {
            clock.Stop();

            return new AiProbe(
                false,
                $"{state.Detail} Inicia sesión desde este mismo diálogo.",
                clock.ElapsedMilliseconds);
        }

        var model = await ModelAsync(request, cancellationToken);

        clock.Stop();

        /*
         * Una sesión que no se pudo averiguar no es una sesión que no hay.
         *
         * Se deja pasar diciendo lo que se sabe, porque negarla mandaría a
         * repetir un inicio de sesión que quizá esté hecho.
         */
        var sesion = state.LoggedIn == true ? state.Detail : $"{state.Detail} Se intentará igual.";

        return new AiProbe(true, $"{sesion} {ModelNote(request, model)}", clock.ElapsedMilliseconds);
    }

    /// <summary>
    /// Qué se le dice al usuario sobre el modelo con el que va a hablar.
    ///
    /// **El predeterminado de Codex no sirve con una cuenta de ChatGPT**, y eso
    /// no se ve hasta la primera pregunta: el programa contesta que el modelo
    /// «is not supported when using Codex with a ChatGPT account» y el turno se
    /// pierde. Comprobado contra el programa real. Por eso el nombre elegido se
    /// dice aquí, donde todavía se puede cambiar.
    /// </summary>
    private static string ModelNote(AiRequest request, string model)
    {
        if (model.Length > 0)
        {
            return $"Se preguntará con «{model}».";
        }

        return IsCodex(request.Profile.Command)
            ? "No se pudo leer el catálogo de la cuenta, así que se usará el modelo "
                + "predeterminado del programa, que con una cuenta de ChatGPT puede no estar "
                + "permitido. Elige uno con «Ver los suyos» si falla."
            : "Se preguntará con el modelo predeterminado de tu cuenta.";
    }

    /// <summary>
    /// El modelo con el que se va a hablar, elegido o sacado del catálogo.
    ///
    /// Dejar el campo vacío tiene que seguir funcionando —es lo que hace que el
    /// asistente sirva sin saberse ningún identificador—, y para Codex eso
    /// obliga a elegir: su predeterminado es un modelo que las cuentas de
    /// ChatGPT no tienen permitido, así que se toma el primero de los que la
    /// propia cuenta declara. Claude no publica catálogo y se queda con el suyo,
    /// que sí funciona.
    /// </summary>
    private async Task<string> ModelAsync(AiRequest request, CancellationToken cancellationToken)
    {
        if (request.Profile.Model.Length > 0 || !IsCodex(request.Profile.Command))
        {
            return request.Profile.Model;
        }

        var models = await ListModelsAsync(request, cancellationToken);

        return models.Count > 0 ? models[0] : string.Empty;
    }

    internal static bool IsCodex(string command) =>
        command.Equals("codex", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// Arma la orden con la que se le habla al programa.
    ///
    /// Los argumentos los pone Druse y no el usuario: de ellos depende que el
    /// asistente no pueda tocar el disco, y un campo de texto donde escribirlos
    /// sería un campo donde quitarlos.
    /// </summary>
    private static Process Start(AiRequest request, string model)
    {
        // El programa se busca en el PATH como lo haria una consola: en Windows
        // los de npm son `.cmd`, y `Process.Start` a secas no los encuentra.
        var path = CliPath.Find(request.Profile.Command)
            ?? throw new InvalidOperationException(
                $"No se encontro «{request.Profile.Command}» en este equipo.");
        var shell = CliPath.NeedsShell(path);

        var info = PipeStartInfo(shell ? "cmd.exe" : path);

        // Fuera del proyecto: sin esto, el programa leería los archivos de
        // instrucciones del repositorio donde esté Druse y respondería con
        // ellos en la cabeza.
        info.WorkingDirectory = Path.GetTempPath();

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

        foreach (var argument in Arguments(request, model))
        {
            info.ArgumentList.Add(argument);
        }

        return new Process { StartInfo = info };
    }

    /// <summary>
    /// UTF-8 sin marca de orden de bytes, en los tres sentidos.
    ///
    /// **La entrada es la que importa.** Sin decirlo, .NET escribe en la página
    /// de códigos de la consola —850 o 1252 en un Windows en español—, y el
    /// prompt lleva tildes desde la primera frase. Claude lo tragaba; Codex
    /// exige UTF-8 y rechazaba el turno entero con «input is not valid UTF-8».
    /// Sin marca de orden: un BOM delante del prompt sería un carácter más que
    /// el programa leería como parte de la pregunta.
    /// </summary>
    internal static readonly Encoding PipeEncoding = new UTF8Encoding(encoderShouldEmitUTF8Identifier: false);

    /// <summary>Cómo se lanza el programa: sin ventana y con las tres tuberías en UTF-8.</summary>
    internal static ProcessStartInfo PipeStartInfo(string fileName) => new(fileName)
    {
        RedirectStandardInput = true,
        RedirectStandardOutput = true,
        RedirectStandardError = true,
        UseShellExecute = false,
        CreateNoWindow = true,
        StandardInputEncoding = PipeEncoding,
        StandardOutputEncoding = PipeEncoding,
        // Los errores también: son lo que se le enseña al usuario cuando algo
        // falla, y con otra página de códigos sus tildes salían rotas.
        StandardErrorEncoding = PipeEncoding,
    };

    private static IEnumerable<string> Arguments(AiRequest request, string model)
    {
        if (IsCodex(request.Profile.Command))
        {
            yield return "exec";
            yield return "--json";
            yield return "--ephemeral";
            yield return "--sandbox";
            yield return "read-only";
            yield return "--skip-git-repo-check";

            if (model.Length > 0)
            {
                yield return "--model";
                yield return model;
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

        if (model.Length > 0)
        {
            yield return "--model";
            yield return model;
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
