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

    public async Task<CliSessionState> InspectAsync(string command, CancellationToken cancellationToken)
    {
        var version = await RunAsync(command, ["--version"], cancellationToken);

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
         * `claude` sabe contestar por sí mismo; `codex` no de forma fiable.
         *
         * Se distingue por el nombre del programa y no por una capacidad
         * declarada porque son dos, y montar un registro para dos casos sería
         * más código del que ahorra.
         */
        if (!command.Equals("claude", StringComparison.OrdinalIgnoreCase))
        {
            return new CliSessionState(
                true,
                null,
                null,
                null,
                $"«{command}» está instalado. No sabe decir si hay sesión iniciada: pruébalo y verás.");
        }

        var status = await RunAsync(command, ["auth", "status", "--json"], cancellationToken);

        if (status is null)
        {
            return new CliSessionState(true, null, null, null, "Está instalado, pero no dijo su estado.");
        }

        return ReadClaudeStatus(status);
    }

    public async Task<bool> StartLoginAsync(string command, CancellationToken cancellationToken)
    {
        // Antes de abrir nada se comprueba que hay algo que abrir: una ventana
        // que aparece y se cierra sola no le dice a nadie qué falta.
        if (await RunAsync(command, ["--version"], cancellationToken) is null)
        {
            return false;
        }

        var arguments = command.Equals("claude", StringComparison.OrdinalIgnoreCase)
            ? "auth login"
            : "login";

        /*
         * En una consola propia y visible, no dentro de Druse.
         *
         * El inicio de sesión abre un navegador y pide pegar un código: hace
         * falta una ventana donde teclear. Por eso se lanza con el intérprete y
         * `/k`, que la deja abierta al terminar para que se pueda leer lo que
         * dijo.
         */
        var path = CliPath.Find(command) ?? command;

        var info = OperatingSystem.IsWindows()
            ? new ProcessStartInfo("cmd.exe", $"/k \"{path}\" {arguments}")
            : new ProcessStartInfo(path, arguments);

        info.UseShellExecute = true;
        info.CreateNoWindow = false;

        try
        {
            using var process = Process.Start(info);

            return process is not null;
        }
        catch (Exception error) when (error is System.ComponentModel.Win32Exception or InvalidOperationException)
        {
            return false;
        }
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

            var output = await process.StandardOutput.ReadToEndAsync(limit.Token);

            await process.WaitForExitAsync(limit.Token);

            return process.ExitCode == 0 ? output.Trim() : null;
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
