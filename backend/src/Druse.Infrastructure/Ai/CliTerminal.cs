using System.Diagnostics;
using System.Runtime.Versioning;

namespace Druse.Infrastructure.Ai;

/// <summary>
/// Abre una ventana de consola donde el programa pueda pedir la cuenta.
///
/// **Hace falta una ventana de verdad, y eso es lo único de todo el asistente
/// que depende del escritorio.** El inicio de sesión de `claude` y de `codex`
/// abre un navegador y pide pegar un código de vuelta: sin un sitio donde
/// teclear, el proceso no termina. Por eso no vale lanzarlo con la salida
/// redirigida como el resto de las órdenes.
///
/// Estaba resuelto con `cmd.exe` escrito a fuego, que en Windows funciona y
/// fuera de Windows no existe: el botón de iniciar sesión no podía hacer nada en
/// Linux ni en macOS, contra lo que pide el ADR 0003. Aquí se elige por
/// plataforma, y **el camino de Windows es el único comprobado contra el sistema
/// real**; los otros dos se escriben con las órdenes documentadas de cada
/// escritorio. Justo por eso quien llama recibe siempre la orden equivalente
/// para teclearla a mano: si la ventana no se abre, la función sigue siendo
/// terminable en lugar de convertirse en un botón muerto.
/// </summary>
public static class CliTerminal
{
    /// <summary>
    /// Emuladores de terminal de Linux y cómo se les pasa una orden.
    ///
    /// En orden de preferencia: primero el alias que las distribuciones basadas
    /// en Debian mantienen apuntando al terminal elegido por el usuario, después
    /// los de cada escritorio, y `xterm` al final porque está donde no hay otra
    /// cosa. Los que llevan `--` lo exigen para no confundir la orden con sus
    /// propias opciones; `kitty` no lleva nada porque recibe la orden directa.
    /// </summary>
    private static readonly (string Command, string[] Before)[] LinuxTerminals =
    [
        ("x-terminal-emulator", ["-e"]),
        ("gnome-terminal", ["--"]),
        ("konsole", ["-e"]),
        ("xfce4-terminal", ["-e"]),
        ("tilix", ["-e"]),
        ("alacritty", ["-e"]),
        ("kitty", []),
        ("xterm", ["-e"]),
    ];

    /// <summary>
    /// Con qué arrancar la ventana, o `null` si en este equipo no hay ninguna.
    /// </summary>
    /// <param name="path">Ruta real del programa, ya resuelta.</param>
    /// <param name="arguments">Lo que se le pasa: `auth login` o `login`.</param>
    /// <param name="variable">Variable que cambia su carpeta de credenciales.</param>
    /// <param name="home">Esa carpeta, o `null` para la sesión del equipo.</param>
    public static ProcessStartInfo? Open(
        string path,
        string arguments,
        string variable,
        string? home)
    {
        if (OperatingSystem.IsWindows())
        {
            /*
             * `/k` deja la ventana abierta al terminar, para poder leer lo que
             * dijo. La variable se pone con `set` dentro del propio intérprete y
             * no con `EnvironmentVariables`, porque eso obliga a
             * `UseShellExecute = false` y entonces no hay ventana donde teclear.
             * Las comillas alrededor de la asignación son las que aguantan una
             * ruta con espacios.
             */
            return new ProcessStartInfo("cmd.exe")
            {
                Arguments = home is null
                    ? $"/k \"{path}\" {arguments}"
                    : $"/k set \"{variable}={home}\" && \"{path}\" {arguments}",
                UseShellExecute = true,
                CreateNoWindow = false,
            };
        }

        var script = Script(path, arguments, variable, home);

        return OperatingSystem.IsMacOS() ? MacOs(script) : Linux(script);
    }

    /// <summary>
    /// La orden equivalente, para quien prefiera —o tenga que— teclearla.
    ///
    /// Se escribe con la sintaxis del intérprete de cada sistema porque va a
    /// pegarse tal cual en una consola: en Windows la variable se pone con `set`
    /// en una orden aparte, y en el resto delante de la propia orden.
    /// </summary>
    public static string Manual(string command, string arguments, string variable, string? home)
    {
        if (home is null)
        {
            return $"{command} {arguments}";
        }

        return OperatingSystem.IsWindows()
            ? $"set \"{variable}={home}\" && {command} {arguments}"
            : $"{variable}=\"{home}\" {command} {arguments}";
    }

    /// <summary>
    /// Lo que se ejecuta dentro de la ventana, en una sola línea de `sh`.
    ///
    /// Termina llamando a `sh` otra vez para que la ventana no se cierre en
    /// cuanto acabe el inicio de sesión, que es lo que hace `/k` en Windows: sin
    /// eso, un fallo desaparecería antes de que nadie pudiera leerlo.
    /// </summary>
    private static string Script(string path, string arguments, string variable, string? home)
    {
        var exports = home is null ? string.Empty : $"export {variable}={Quote(home)}; ";

        return $"{exports}{Quote(path)} {arguments}; exec sh";
    }

    /// <summary>
    /// Entrecomillado de `sh`: todo entre comillas simples y las de dentro
    /// partidas. Una ruta de usuario puede llevar espacios y también apóstrofos.
    /// </summary>
    private static string Quote(string value) => $"'{value.Replace("'", "'\\''")}'";

    /// <summary>
    /// En macOS la ventana la abre Terminal.app, y solo sabe abrir archivos.
    ///
    /// Por eso la orden se deja en un `.command` temporal y ejecutable en lugar
    /// de pasarse como argumento. Queda un archivo en la carpeta temporal del
    /// sistema, que es donde se le espera y de donde se limpia solo.
    /// </summary>
    [SupportedOSPlatform("macos")]
    private static ProcessStartInfo? MacOs(string script)
    {
        try
        {
            var file = Path.Combine(
                Path.GetTempPath(),
                $"druse-login-{Guid.NewGuid():N}.command");

            File.WriteAllText(file, $"#!/bin/sh\n{script}\n");
            File.SetUnixFileMode(
                file,
                UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);

            var info = new ProcessStartInfo("open") { UseShellExecute = false };

            info.ArgumentList.Add("-a");
            info.ArgumentList.Add("Terminal");
            info.ArgumentList.Add(file);

            return info;
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
            // Sin poder dejar el guion no hay nada que abrir. Quien llama tiene
            // la orden manual, que aquí es la única salida.
            return null;
        }
    }

    /// <summary>El primero de los emuladores conocidos que esté instalado.</summary>
    private static ProcessStartInfo? Linux(string script)
    {
        foreach (var (command, before) in LinuxTerminals)
        {
            if (CliPath.Find(command) is not { } terminal)
            {
                continue;
            }

            var info = new ProcessStartInfo(terminal) { UseShellExecute = false };

            foreach (var argument in before)
            {
                info.ArgumentList.Add(argument);
            }

            info.ArgumentList.Add("sh");
            info.ArgumentList.Add("-c");
            info.ArgumentList.Add(script);

            return info;
        }

        return null;
    }
}
