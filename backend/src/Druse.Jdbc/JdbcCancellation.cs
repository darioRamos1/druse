namespace Druse.Jdbc;

/// <summary>
/// Ejecuta trabajo bloqueante de JDBC de forma que se pueda cancelar.
///
/// JDBC no tiene API asíncrona: `execute`, `next` y compañía bloquean el hilo
/// hasta que el servidor contesta. Llamarlos desde el hilo que espera dejaría la
/// aplicación congelada delante de una consulta de diez minutos.
///
/// **Con Informix, cancelar de verdad no es posible.** Comprobado contra el
/// servidor con la misma consulta larga que usa el contrato: `Statement.cancel()`
/// a los 3 s, `setQueryTimeout(5)` y hasta cerrar la conexión desde otro hilo
/// terminan los tres a los ~250 s, que es lo que la consulta tardaba de todos
/// modos. El driver llega a decir «exceeded timeout of 5 seconds», pero solo
/// cuando el servidor por fin responde: el hilo se queda dentro del socket y
/// nada lo saca de ahí.
///
/// Así que lo que se hace es **dejar de esperar**: quien canceló recupera el
/// control al instante y la consulta se suelta. Sigue corriendo en el servidor
/// hasta que acabe sola. La conexión se retira de uso y se cierra físicamente
/// cuando el driver la libera; una sesión nueva permite seguir trabajando.
/// </summary>
internal static class JdbcCancellation
{
    public static async Task<T> RunAsync<T>(
        Func<T> trabajo,
        Action cancelar,
        CancellationToken cancellationToken,
        Action<Task>? abandonar = null)
    {
        cancellationToken.ThrowIfCancellationRequested();

        var tarea = Task.Run(trabajo, CancellationToken.None);

        // Enlazado y no el token pelado: cuando el trabajo gana la carrera hay
        // que cancelar esta espera, o cada consulta dejaría un temporizador vivo
        // colgando del token hasta que alguien lo desechara.
        using var fin = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);

        var espera = Task.Delay(Timeout.Infinite, fin.Token);
        var primera = await Task.WhenAny(tarea, espera).ConfigureAwait(false);

        if (primera == tarea)
        {
            await fin.CancelAsync().ConfigureAwait(false);

            return await tarea.ConfigureAwait(false);
        }

        // Se pide igualmente: hoy este driver lo ignora, pero es lo correcto y
        // el día que lo atienda —u otro driver use esto— la consulta morirá de
        // verdad en vez de quedarse corriendo.
        // El propio cancel() también puede esperar el mismo socket que execute.
        // Pedirlo en este hilo convertiría «dejar de esperar» en otra espera sin
        // límite. El cierre físico se pospone hasta que ambos hayan salido del
        // driver; mientras tanto, la conexión no se vuelve a ofrecer para uso.
        var intento = Task.Run(() => Intentar(cancelar));
        var pendiente = Task.WhenAll(Soltar(tarea), intento);
        abandonar?.Invoke(pendiente);

        throw new OperationCanceledException("La operación se canceló.", cancellationToken);
    }

    private static void Intentar(Action cancelar)
    {
        try
        {
            cancelar();
        }
        catch (Exception exception) when (exception is not OutOfMemoryException)
        {
            // Cancelar es un intento, no una obligación: que falle no cambia lo
            // que hay que contarle a quien canceló.
        }
    }

    /// <summary>
    /// Deja la tarea a su suerte, pero sin dejar basura detrás.
    ///
    /// Dos cosas hay que atender aunque ya no interese el resultado: **observar
    /// su excepción**, porque una tarea que falla sin que nadie la mire acaba en
    /// el manejador de excepciones no observadas, y **cerrar lo que devuelva**,
    /// porque si es un lector nadie más va a hacerlo y se quedaría abierto sobre
    /// una conexión que sigue viva.
    /// </summary>
    internal static Task Soltar<T>(Task<T> tarea) =>
        tarea.ContinueWith(
            terminada =>
            {
                if (terminada.IsFaulted)
                {
                    _ = terminada.Exception;
                    return;
                }

                if (terminada.IsCompletedSuccessfully && terminada.Result is IDisposable desechable)
                {
                    try
                    {
                        desechable.Dispose();
                    }
                    catch (Exception exception) when (exception is not OutOfMemoryException)
                    {
                        // La conexión pudo caerse mientras tanto; no hay nada que
                        // hacer con eso y nadie a quien contárselo.
                    }
                }
            },
            CancellationToken.None,
            // Puede que el resultado haya llegado justo después de ganar el
            // token. Su Dispose también puede bloquear: nunca corre en el hilo
            // que debe devolver la cancelación.
            TaskContinuationOptions.None,
            TaskScheduler.Default);

    /// <summary>No vuelve a entrar en el driver mientras tenga trabajo pendiente.</summary>
    internal static Task AlTerminar(Task pendiente, Action cerrar) =>
        pendiente.ContinueWith(
            terminada =>
            {
                _ = terminada.Exception;
                Intentar(cerrar);
            },
            CancellationToken.None,
            TaskContinuationOptions.None,
            TaskScheduler.Default);
}
