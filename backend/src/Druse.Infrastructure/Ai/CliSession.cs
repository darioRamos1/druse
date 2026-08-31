using System.Diagnostics;
using System.Text.Json;
using Druse.Application.Ai;

namespace Druse.Infrastructure.Ai;

/// <summary>
/// Pregunta a `claude` y a `codex` por su sesión, y abre la suya cuando falta.
///
/// Cada programa contesta a su manera y **ninguna respuesta se inventa**: lo que
/// no se puede averiguar se devuelve como desconocido, porque decir «no tienes
/// sesión» a quien la tiene lo manda a repetir un inicio de sesión que sobra.
/// </summary>
public sealed class CliSession : ICliSession
{
    /// <summary>
    /// Cuánto se espera a que el programa conteste.
    ///
    /// Es una pregunta local que se responde al instante; si tarda más, algo va
    /// mal y es mejor decirlo que dejar la pantalla colgada.
    /// </summary>
    private static readonly TimeSpan Patience = TimeSpan.FromSeconds(20);

    public async Task<CliSessionState> InspectAsync(
        string command,
        string? sessionDirectory,
        CancellationToken cancellationToken)
    {
        var home = sessionDirectory;
        var version = await RunAsync(command, ["--version"], home, cancellationToken);

        if (version is null)
        {
            return new CliSessionState(
                false,
                false,
                null,
                null,
                $"No se encontró «{command}» en este equipo.");
        }

        /*
         * Cada uno contesta a su manera, y las dos formas están comprobadas.
         *
         * `claude auth status --json` devuelve un objeto con la cuenta y el
         * plan; `codex login status` devuelve una línea de texto. Se distingue
         * por el nombre del programa y no por una capacidad declarada porque son
         * dos, y montar un registro para dos casos sería más código del que
         * ahorra.
         */
        if (command.Equals("codex", StringComparison.OrdinalIgnoreCase))
        {
            var line = await RunAsync(command, ["login", "status"], home, cancellationToken);

            return ReadCodexStatus(line);
        }

        var status = await RunAsync(command, ["auth", "status", "--json"], home, cancellationToken);

        if (status is null)
        {
            return new CliSessionState(true, null, null, null, "Está instalado, pero no dijo su estado.");
        }

        return ReadClaudeStatus(status);
    }

    public async Task<CliLaunch> StartLoginAsync(
        string command,
        string? sessionDirectory,
        CancellationToken cancellationToken)
    {
        var home = sessionDirectory;
        var arguments = command.Equals("claude", StringComparison.OrdinalIgnoreCase)
            ? "auth login"
            : "login";
        var variable = CliPath.SessionVariable(command);
        var manual = CliTerminal.Manual(command, arguments, variable, home);

        // Antes de abrir nada se comprueba que hay algo que abrir: una ventana
        // que aparece y se cierra sola no le dice a nadie qué falta.
        if (await RunAsync(command, ["--version"], home, cancellationToken) is null)
        {
            return new CliLaunch(false, manual);
        }

        var path = CliPath.Find(command) ?? command;

        /*
         * La consola hereda el directorio de credenciales.
         *
         * Es lo que hace que la sesión que se inicie ahí sea la de **este
         * perfil** y no la del equipo: sin la variable, entrar con otra cuenta
         * cerraría la que ya usa quien programa con la misma herramienta.
         */
        if (home is not null)
        {
            Directory.CreateDirectory(home);
        }

        if (CliTerminal.Open(path, arguments, variable, home) is not { } info)
        {
            // No hay ventana que abrir —un Linux sin escritorio, o sin ninguno
            // de los emuladores conocidos—. La orden manual deja el trabajo
            // terminable en vez de dejar un botón que no hace nada.
            return new CliLaunch(false, manual);
        }

        try
        {
            using var process = Process.Start(info);

            return new CliLaunch(process is not null, manual);
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return new CliLaunch(false, manual);
        }
    }

    /// <summary>
    /// Lee lo que dice `codex login status`, que es una línea de texto.
    ///
    /// Dice «Logged in using ChatGPT» o «Not logged in». No trae ni la cuenta ni
    /// el plan, así que no se inventan: lo que se sabe es si hay sesión, y eso
    /// es lo que decide si hace falta enseñar el botón de entrar.
    /// </summary>
    private static CliSessionState ReadCodexStatus(string? line)
    {
        if (line is null)
        {
            return new CliSessionState(true, null, null, null, "Está instalado, pero no dijo su estado.");
        }

        /*
         * Lo primero que se descarta es la negación, y no es un detalle.
         *
         * El programa contesta «Not logged in» cuando no hay sesión, y esa frase
         * **contiene** «logged in»: buscar solo lo segundo daba por iniciada
         * justo la sesión que faltaba, y la pantalla escondía el botón de entrar
         * en el único caso donde hace falta.
         *
         * Se busca la frase y no la línea entera porque el programa avisa por su
         * cuenta de cosas que no vienen al caso, como que no pudo crear enlaces
         * en el PATH.
         */
        if (line.Contains("not logged in", StringComparison.OrdinalIgnoreCase))
        {
            return new CliSessionState(true, false, null, null, "Está instalado, pero sin sesión.");
        }

        if (line.Contains("Logged in", StringComparison.OrdinalIgnoreCase))
        {
            var chatgpt = line.Contains("ChatGPT", StringComparison.OrdinalIgnoreCase);

            return new CliSessionState(
                true,
                true,
                null,
                chatgpt ? "ChatGPT" : null,
                chatgpt ? "Sesión iniciada con tu cuenta de ChatGPT." : "Sesión iniciada.");
        }

        return new CliSessionState(true, false, null, null, "Está instalado, pero sin sesión.");
    }

    private static CliSessionState ReadClaudeStatus(string json)
    {
        try
        {
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;

            var loggedIn = root.TryGetProperty("loggedIn", out var flag)
                && flag.ValueKind == JsonValueKind.True;

            if (!loggedIn)
            {
                return new CliSessionState(true, false, null, null, "Está instalado, pero sin sesión.");
            }

            var account = Text(root, "email");
            var plan = Text(root, "subscriptionType");

            return new CliSessionState(
                true,
                true,
                account,
                plan,
                plan is null ? "Sesión iniciada." : $"Sesión iniciada · plan {plan}.");
        }
        catch (JsonException)
        {
            // Contestó algo que no se entiende. Que exista ya es información;
            // inventar el resto no lo es.
            return new CliSessionState(true, null, null, null, "Está instalado, pero no se entendió su estado.");
        }
    }

    private static string? Blank(string text) => text.Trim() is { Length: > 0 } said ? said : null;

    private static string? Text(JsonElement root, string name) =>
        root.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    /// <summary>
    /// Ejecuta el programa y devuelve lo que escribió, o `null` si no se pudo.
    /// </summary>
    private static async Task<string?> RunAsync(
        string command,
        string[] arguments,
        string? home,
        CancellationToken cancellationToken)
    {
        var path = CliPath.Find(command);

        if (path is null)
        {
            return null;
        }

        // Un `.cmd` lo corre el interprete; lanzarlo directamente falla con «no
        // es una aplicacion Win32 valida».
        var shell = CliPath.NeedsShell(path);

        var info = new ProcessStartInfo(shell ? "cmd.exe" : path)
        {
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            UseShellExecute = false,
            CreateNoWindow = true,
            WorkingDirectory = Path.GetTempPath(),
        };

        // Con directorio propio, el programa mira ahi sus credenciales y no las
        // del equipo: es lo que permite tener dos cuentas a la vez.
        if (home is not null)
        {
            Directory.CreateDirectory(home);
            info.EnvironmentVariables[CliPath.SessionVariable(command)] = home;
        }

        if (shell)
        {
            info.ArgumentList.Add("/c");
            info.ArgumentList.Add(path);
        }

        foreach (var argument in arguments)
        {
            info.ArgumentList.Add(argument);
        }

        try
        {
            using var process = Process.Start(info);

            if (process is null)
            {
                return null;
            }

            using var limit = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

            limit.CancelAfter(Patience);

            /*
             * Los dos canales, y a la vez.
             *
             * `codex login status` escribe su respuesta por **stderr**, no por
             * la salida normal: leyendo solo stdout, Druse decia «no dijo su
             * estado» sobre un programa que estaba contestando «Logged in using
             * ChatGPT». Se leen los dos, y en paralelo porque leerlos uno detras
             * de otro se bloquea en cuanto el bufer del que espera se llena.
             */
            var outText = process.StandardOutput.ReadToEndAsync(limit.Token);
            var errText = process.StandardError.ReadToEndAsync(limit.Token);

            await Task.WhenAll(outText, errText);
            await process.WaitForExitAsync(limit.Token);

            /*
             * Lo que dijo vale aunque termine con error.
             *
             * `claude auth status` sale con codigo distinto de cero **cuando no
             * hay sesion**, que es justo el caso que hay que distinguir: tirar su
             * respuesta por el codigo convertia «no has entrado» en «no se
             * entendio su estado», y con eso la pantalla no podia ofrecer el
             * boton de iniciar sesion. Solo se descarta cuando no dijo nada.
             */
            var said = outText.Result.Trim();

            return said.Length > 0 ? said : Blank(errText.Result);
        }
        catch (Exception error)
            when (error is System.ComponentModel.Win32Exception
                or InvalidOperationException
                or OperationCanceledException)
        {
            return null;
        }
    }
}
