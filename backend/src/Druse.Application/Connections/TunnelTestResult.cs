using Druse.Domain;

namespace Druse.Application.Connections;

/// <summary>Hasta dónde se llegó al probar el túnel.</summary>
public enum TunnelReach
{
    /// <summary>Ni siquiera se intentó: el perfil no usa servidor intermedio.</summary>
    NotConfigured = 0,

    /// <summary>No se pudo entrar en el servidor intermedio.</summary>
    Bastion = 1,

    /// <summary>Se entró, pero desde allí no se alcanzó el servidor de la base.</summary>
    Forward = 2,

    /// <summary>El camino entero funciona.</summary>
    Complete = 3,
}

/// <summary>
/// Resultado de probar el túnel **sin hablar con la base de datos**.
///
/// Existe porque «no se pudo conectar» tapa dos problemas que se arreglan en
/// sitios distintos: que el servidor intermedio no te deje entrar —usuario,
/// clave, segundo factor— y que, habiendo entrado, desde él no se llegue al
/// servidor de la base. Lo primero lo arregla quien tiene la cuenta SSH; lo
/// segundo, quien configura la red o el cortafuegos.
///
/// Aquí no se abre ninguna conexión de base de datos: se comprueba que el
/// extremo local del reenvío acepta un socket, y con eso el camino queda
/// demostrado hasta el puerto del motor.
/// </summary>
public sealed record TunnelTestResult
{
    public required bool Succeeded { get; init; }

    public required TunnelReach Reach { get; init; }

    /// <summary>Motivo del fallo, pensado para enseñarlo y sin secretos dentro.</summary>
    public QueryError? Error { get; init; }

    public required TimeSpan Duration { get; init; }

    public static TunnelTestResult NotConfigured() => new()
    {
        Succeeded = false,
        Reach = TunnelReach.NotConfigured,
        Duration = TimeSpan.Zero,
        Error = new QueryError
        {
            Message = "Esta conexión no usa servidor intermedio: no hay túnel que probar.",
            Localized = new UserMessage(
                MessageKeys.Tunnel.NotConfigured,
                "Esta conexión no usa servidor intermedio: no hay túnel que probar."),
        },
    };

    /// <param name="localized">
    /// El mismo motivo con su clave, cuando lo escribe Druse. Lo que venga del
    /// servidor SSH llega como él lo diga y va sin clave.
    /// </param>
    public static TunnelTestResult Failure(
        TunnelReach reach,
        string message,
        TimeSpan duration,
        UserMessage? localized = null) =>
        new()
        {
            Succeeded = false,
            Reach = reach,
            Duration = duration,
            Error = new QueryError { Message = message, Localized = localized },
        };

    public static TunnelTestResult Success(TimeSpan duration) => new()
    {
        Succeeded = true,
        Reach = TunnelReach.Complete,
        Duration = duration,
    };
}
