using System.Diagnostics;
using System.Runtime.InteropServices;

using Druse.Host.LocalApi;

using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging.Abstractions;

namespace Druse.IntegrationTests;

/// <summary>
/// La API se apaga cuando desaparece quien la arrancó.
///
/// Estas pruebas existen por un fallo que se descubrió probando el ciclo de
/// instalación entero: al matar la ventana sin que pudiera cerrarse bien, la API
/// quedaba viva con sus archivos bloqueados, y **desinstalar Druse dejaba setenta
/// megas dentro de `api\`** sin que nadie se enterara.
/// </summary>
public sealed class ParentProcessWatcherTests
{
    /// <summary>Registra si alguien pidió apagar, que es lo único que importa aquí.</summary>
    private sealed class RecordingLifetime : IHostApplicationLifetime, IDisposable
    {
        private readonly CancellationTokenSource _stopping = new();

        public bool Stopped { get; private set; }

        public CancellationToken ApplicationStarted => CancellationToken.None;

        public CancellationToken ApplicationStopping => _stopping.Token;

        public CancellationToken ApplicationStopped => CancellationToken.None;

        public void StopApplication()
        {
            Stopped = true;
            _stopping.Cancel();
        }

        public void Dispose() => _stopping.Dispose();
    }

    private static ParentProcessWatcher Watcher(IHostApplicationLifetime lifetime, int parentId) =>
        new(lifetime, NullLogger<ParentProcessWatcher>.Instance, parentId);

    /// <summary>
    /// Un proceso que se queda esperando, para poder matarlo cuando convenga.
    ///
    /// Se lanza con el intérprete de cada sistema porque no hay un ejecutable que
    /// exista en los tres y espere sin hacer nada.
    /// </summary>
    private static Process StartWaitingProcess()
    {
        var info = RuntimeInformation.IsOSPlatform(OSPlatform.Windows)
            ? new ProcessStartInfo("cmd.exe", "/c timeout /t 30 /nobreak")
            : new ProcessStartInfo("sh", "-c \"sleep 30\"");

        info.CreateNoWindow = true;
        info.UseShellExecute = false;

        return Process.Start(info)!;
    }

    [Fact]
    public async Task CuandoSeCierraQuienLaArranco_SeApaga()
    {
        using var lifetime = new RecordingLifetime();
        using var parent = StartWaitingProcess();

        var watcher = Watcher(lifetime, parent.Id);
        await watcher.StartAsync(CancellationToken.None);

        Assert.False(lifetime.Stopped, "No debe apagarse mientras el padre sigue vivo.");

        parent.Kill();

        // Se espera a que el vigilante reaccione, no una cantidad fija: lo que se
        // comprueba es que reacciona, no en cuánto.
        var limite = DateTime.UtcNow.AddSeconds(15);

        while (!lifetime.Stopped && DateTime.UtcNow < limite)
        {
            await Task.Delay(50);
        }

        Assert.True(lifetime.Stopped, "Al morir el padre, la API tiene que cerrarse sola.");

        await watcher.StopAsync(CancellationToken.None);
    }

    /// <summary>
    /// Si el padre ya no está al arrancar, no hay a quién servir.
    ///
    /// Pasa cuando la ventana muere entre que lanza la API y esta termina de
    /// levantarse: sin esto, quedaría una API para nadie.
    /// </summary>
    [Fact]
    public async Task SiQuienLaArrancoYaNoEsta_SeApagaAlInstante()
    {
        using var lifetime = new RecordingLifetime();

        var parent = StartWaitingProcess();
        var identificador = parent.Id;
        parent.Kill();
        await parent.WaitForExitAsync();
        parent.Dispose();

        var watcher = Watcher(lifetime, identificador);
        await watcher.StartAsync(CancellationToken.None);

        var limite = DateTime.UtcNow.AddSeconds(10);

        while (!lifetime.Stopped && DateTime.UtcNow < limite)
        {
            await Task.Delay(50);
        }

        Assert.True(lifetime.Stopped);

        await watcher.StopAsync(CancellationToken.None);
    }

    /// <summary>
    /// Apagarse por su cuenta no debe contarse como que murió el padre.
    ///
    /// Si no se distinguiera, cada cierre normal registraría un aviso de que la
    /// ventana se cerró mal, y ese aviso dejaría de significar nada.
    /// </summary>
    [Fact]
    public async Task SiSeCierraLaApiPorSuCuenta_NoAvisaDeNada()
    {
        using var lifetime = new RecordingLifetime();
        using var parent = StartWaitingProcess();

        var watcher = Watcher(lifetime, parent.Id);
        await watcher.StartAsync(CancellationToken.None);
        await watcher.StopAsync(CancellationToken.None);

        Assert.False(lifetime.Stopped);

        parent.Kill();
    }
}
