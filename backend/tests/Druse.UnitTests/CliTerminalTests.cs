using Druse.Infrastructure.Ai;

namespace Druse.UnitTests;

/// <summary>
/// La orden que se le ofrece a quien no puede abrir la ventana desde Druse.
///
/// Se prueba esto y no la apertura en sí: abrir una consola exige un escritorio
/// delante, y una prueba automática no lo tiene. Lo que sí se puede comprobar —y
/// es lo que importa cuando la ventana no sale— es que la línea que se enseña
/// esté completa, con la variable de entorno dentro, que es la parte que nadie
/// adivinaría.
/// </summary>
public sealed class CliTerminalTests
{
    [Fact]
    public void LaOrdenLlevaLaCarpetaDeCredencialesDelPerfil()
    {
        var manual = CliTerminal.Manual(
            "claude",
            "auth login",
            "CLAUDE_CONFIG_DIR",
            "/datos/ai-sessions/abc");

        Assert.Contains("CLAUDE_CONFIG_DIR", manual, StringComparison.Ordinal);
        Assert.Contains("/datos/ai-sessions/abc", manual, StringComparison.Ordinal);
        Assert.Contains("claude auth login", manual, StringComparison.Ordinal);
    }

    /// <summary>
    /// Sin cuenta propia no se nombra ninguna variable.
    ///
    /// Poner una carpeta donde el usuario quería la sesión del equipo sería
    /// mandarlo a crear una cuenta separada sin haberla pedido.
    /// </summary>
    [Fact]
    public void LaOrdenDeLaSesionDelEquipoNoLlevaVariable()
    {
        var manual = CliTerminal.Manual("codex", "login", "CODEX_HOME", null);

        Assert.Equal("codex login", manual);
    }

    /// <summary>
    /// En Windows la ventana se abre con el intérprete del sistema.
    ///
    /// Es el único camino de los tres comprobado contra el sistema real; los de
    /// Linux y macOS se apoyan en las órdenes documentadas de cada escritorio, y
    /// por eso la orden manual acompaña siempre al resultado.
    /// </summary>
    [WindowsFact]
    public void EnWindowsSeAbreConElInterpreteDelSistema()
    {
        var info = CliTerminal.Open(
            @"C:\npm\claude.cmd",
            "auth login",
            "CLAUDE_CONFIG_DIR",
            @"C:\datos\ai-sessions\abc");

        Assert.NotNull(info);
        Assert.Equal("cmd.exe", info.FileName);
        Assert.Contains("CLAUDE_CONFIG_DIR", info.Arguments, StringComparison.Ordinal);

        // Sin esto no hay ventana donde teclear el código que pide el navegador.
        Assert.True(info.UseShellExecute);
        Assert.False(info.CreateNoWindow);
    }
}

/// <summary>Una prueba que solo tiene sentido donde existe `cmd.exe`.</summary>
public sealed class WindowsFactAttribute : FactAttribute
{
    public WindowsFactAttribute()
    {
        if (!OperatingSystem.IsWindows())
        {
            Skip = "El camino de Windows solo existe en Windows.";
        }
    }
}
