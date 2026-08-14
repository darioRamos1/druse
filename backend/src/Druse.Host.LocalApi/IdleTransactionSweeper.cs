using Druse.Application.Transactions;

namespace Druse.Host.LocalApi;

/// <summary>
/// Deshace cada poco las transacciones que el usuario dejó olvidadas.
///
/// Es la mitad que hace que el modo manual sea aceptable en una base compartida:
/// una transacción abierta mantiene filas bloqueadas para todos los demás, y la
/// forma habitual de dejarla así no es un fallo del programa sino irse a comer
/// con la pestaña abierta.
///
/// Corre en el proceso y no en un temporizador del navegador porque la ventana
/// puede estar cerrada, minimizada o dormida, y es justo entonces cuando hay que
/// soltar los bloqueos.
/// </summary>
internal sealed class IdleTransactionSweeper(
    TransactionService transactions,
    ILogger<IdleTransactionSweeper> logger) : BackgroundService
{
    /// <summary>
    /// Cada cuánto se mira.
    ///
    /// Un minuto es suficiente: lo que se busca no es cortar al segundo, sino que
    /// nadie se pase la comida bloqueando una tabla. Mirar más a menudo pediría el
    /// turno de cada sesión sin ninguna ganancia.
    /// </summary>
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    private readonly TransactionService _transactions = transactions;
    private readonly ILogger<IdleTransactionSweeper> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(Interval);

        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                var abandoned = await _transactions.RollbackIdleAsync(stoppingToken);

                if (abandoned.Count > 0 && _logger.IsEnabled(LogLevel.Information))
                {
                    foreach (var state in abandoned)
                    {
                        _logger.LogInformation(
                            "Se deshizo la transacción de «{Connection}» tras {Seconds} s sin actividad.",
                            state.ConnectionName,
                            state.IdleTimeoutSeconds);
                    }
                }
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                // Que falle un barrido no puede llevarse el barrido siguiente: la
                // conexión pudo caerse justo mientras se deshacía, y eso no es
                // motivo para dejar de vigilar el resto de sesiones.
                _logger.LogWarning(exception, "No se pudo completar el barrido de transacciones.");
            }
        }
    }
}
