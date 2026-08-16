using System.Diagnostics;

namespace Druse.Host.LocalApi;

/// <summary>
/// Apaga la API cuando desaparece quien la arrancó.
///
/// La API es un proceso auxiliar de la ventana: no tiene vida propia. Al cerrar
/// Druse normalmente, el envoltorio la termina; el problema es **cuando la
/// ventana no llega a cerrarse bien** —un cuelgue, matar el proceso, cerrar la
/// sesión de Windows de golpe—. Ahí la API se quedaba viva, reteniendo su puerto
/// y con sus propios archivos bloqueados.
///
/// Eso no es una fuga inofensiva: con los archivos en uso, **desinstalar Druse
/// deja setenta megas dentro de `api\` y nadie se entera**, porque para Windows
/// la aplicación ya no existe. Se descubrió justo así, probando el ciclo de
/// instalación completo.
///
/// Se vigila desde aquí y no con un Job Object de Windows porque Druse también
/// se compila para Linux y macOS, y esto tiene que valer en los tres.
/// </summary>
internal sealed class ParentProcessWatcher(
    IHostApplicationLifetime lifetime,
    ILogger<ParentProcessWatcher> logger,
    int parentProcessId) : BackgroundService
{
    private readonly IHostApplicationLifetime _lifetime = lifetime;
    private readonly ILogger<ParentProcessWatcher> _logger = logger;
    private readonly int _parentProcessId = parentProcessId;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        Process parent;

        try
        {
            parent = Process.GetProcessById(_parentProcessId);
        }
        catch (ArgumentException)
        {
            // Ya no existe: o murió durante el arranque, o el identificador que
            // llegó era de otra cosa. En ambos casos no hay a quién servir.
            _logger.LogWarning(
                "Quien arrancó la API (proceso {ParentProcessId}) ya no está. Se cierra.",
                _parentProcessId);

            _lifetime.StopApplication();

            return;
        }

        using (parent)
        {
            try
            {
                await parent.WaitForExitAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // La API se está cerrando por su cuenta; no hay nada que hacer.
                return;
            }

            if (_logger.IsEnabled(LogLevel.Information))
            {
                _logger.LogInformation(
                    "Se cerró quien arrancó la API (proceso {ParentProcessId}). Se cierra también.",
                    _parentProcessId);
            }

            _lifetime.StopApplication();
        }
    }
}
