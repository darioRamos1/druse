namespace Druse.Infrastructure.Ai;

/// <summary>
/// Encuentra el programa de verdad detrás de un nombre.
///
/// **En Windows no basta con el nombre.** Los programas que instala npm no son
/// ejecutables sino `.cmd` que llaman a Node —`claude` es `claude.cmd`—, y
/// `Process.Start("claude")` sin intérprete no los encuentra: solo mira los
/// `.exe`. El síntoma es el peor posible: Druse decía «no se encontró claude en
/// este equipo» sobre un equipo donde `claude` funciona desde cualquier consola,
/// y no había forma de saber quién de los dos mentía.
///
/// Se busca como lo haría el intérprete: por cada carpeta del `PATH`, probando
/// el nombre tal cual y con cada extensión de `PATHEXT`.
/// </summary>
public static class CliPath
{
    /// <summary>
    /// Ruta completa del programa, o `null` si no está en este equipo.
    /// </summary>
    public static string? Find(string command)
    {
        if (string.IsNullOrWhiteSpace(command))
        {
            return null;
        }

        // Con ruta propia no hay nada que buscar: se usa la que se dio, si es
        // que existe.
        if (Path.IsPathRooted(command))
        {
            return File.Exists(command) ? command : null;
        }

        var folders = (Environment.GetEnvironmentVariable("PATH") ?? string.Empty)
            .Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

        foreach (var folder in folders)
        {
            foreach (var candidate in Candidates(folder, command))
            {
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
        }

        return null;
    }

    private static IEnumerable<string> Candidates(string folder, string command)
    {
        string plain;

        try
        {
            plain = Path.Combine(folder, command);
        }
        catch (ArgumentException)
        {
            // Una entrada del PATH con caracteres imposibles. Se salta: es un
            // problema del equipo, no algo que deba tumbar la búsqueda.
            yield break;
        }

        // Un ejecutable de verdad gana al `.cmd` que lo envuelve: arranca sin
        // intérprete de por medio.
        if (OperatingSystem.IsWindows())
        {
            var extensions = (Environment.GetEnvironmentVariable("PATHEXT") ?? ".EXE;.CMD;.BAT")
                .Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);

            foreach (var extension in extensions)
            {
                yield return plain + extension.ToLowerInvariant();
            }
        }

        yield return plain;
    }

    /// <summary>
    /// La variable con la que cada programa cambia de carpeta de credenciales.
    ///
    /// No es la misma para los dos y **no se puede adivinar**: poner la de uno
    /// en el otro no da error, simplemente no hace nada, y entonces «otra
    /// cuenta» acabaría usando la del equipo sin que nadie lo note. Las dos
    /// están comprobadas contra el programa de verdad: con la carpeta cambiada
    /// dicen que no hay sesión mientras la del equipo sigue intacta.
    /// </summary>
    public static string SessionVariable(string command) =>
        command.Equals("codex", StringComparison.OrdinalIgnoreCase)
            ? "CODEX_HOME"
            : "CLAUDE_CONFIG_DIR";

    /// <summary>
    /// Un `.cmd` o un `.bat` no se ejecutan solos: los corre el intérprete.
    ///
    /// Lanzarlos directamente falla con «no es una aplicación Win32 válida», que
    /// es otro mensaje que no le dice nada a nadie.
    ///
    /// La pregunta solo tiene sentido en Windows, y por eso se comprueba: fuera
    /// de ahí un archivo con esa extensión es un archivo con esa extensión, y
    /// mandarlo a un `cmd.exe` que no existe convertiría un programa que corre
    /// en un programa que no arranca.
    /// </summary>
    public static bool NeedsShell(string path) =>
        OperatingSystem.IsWindows()
        && (path.EndsWith(".cmd", StringComparison.OrdinalIgnoreCase)
            || path.EndsWith(".bat", StringComparison.OrdinalIgnoreCase));
}
