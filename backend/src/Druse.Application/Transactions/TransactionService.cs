using System.Collections.Concurrent;
using Druse.Application.Abstractions;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Transactions;

/// <summary>Por qué no se pudo hacer lo que se pidió con la transacción.</summary>
public enum TransactionRefusal
{
    /// <summary>Ya había una abierta en esa conexión.</summary>
    AlreadyOpen = 1,

    /// <summary>No hay ninguna abierta que confirmar o deshacer.</summary>
    NotOpen = 2,

    /// <summary>La conexión está marcada como solo lectura.</summary>
    ReadOnlyConnection = 3,
}

/// <summary>La operación se rechazó antes de tocar el motor.</summary>
public sealed record TransactionRejection(TransactionRefusal Reason, string Message);

public sealed class TransactionRejectedException(TransactionRejection rejection)
    : InvalidOperationException(rejection.Message)
{
    public TransactionRejection Rejection { get; } = rejection;
}

/// <summary>
/// Lo que hay que saber de la transacción de una sesión para poder enseñarla.
///
/// Lleva a qué conexión y a qué base afecta porque **una transacción no es de la
/// pestaña sino de la conexión**: quien la abrió en una pestaña tiene que poder
/// leer, sin buscarlo, que lo que ejecute en otra del mismo perfil entra en ella.
/// </summary>
public sealed record TransactionState
{
    public required Guid SessionId { get; init; }

    public required bool IsOpen { get; init; }

    public DateTimeOffset? StartedAt { get; init; }

    public DateTimeOffset? LastActivityAt { get; init; }

    /// <summary>Nombre del perfil, que es como el usuario reconoce la conexión.</summary>
    public required string ConnectionName { get; init; }

    public required string Database { get; init; }

    public required DatabaseEngine Engine { get; init; }

    /// <summary>
    /// El DDL de este motor se puede deshacer dentro de la transacción.
    ///
    /// En MySQL no: hace un commit implícito antes de cada `ALTER`, así que crear
    /// una tabla con la transacción abierta queda hecho aunque después se pulse
    /// Rollback. Se dice aquí para que la interfaz pueda avisarlo en lugar de
    /// dejar que el usuario lo descubra al no ver revertida su tabla.
    /// </summary>
    public required bool DdlIsReversible { get; init; }

    /// <summary>Segundos sin actividad tras los cuales se deshace sola.</summary>
    public required int IdleTimeoutSeconds { get; init; }

    /// <summary>
    /// Se deshizo sola por inactividad.
    ///
    /// Sobrevive a la transacción a propósito: el usuario se entera al volver, y
    /// para entonces ya no hay ninguna abierta de la que preguntar. Se borra en
    /// cuanto abre la siguiente.
    /// </summary>
    public DateTimeOffset? AutoRolledBackAt { get; init; }
}

/// <summary>
/// Las transacciones que el usuario abre y cierra a mano.
///
/// El autocommit sigue siendo lo normal: aquí se entra a propósito, con un botón,
/// y hasta entonces cada instrucción se confirma sola como siempre.
///
/// Las reglas de la transacción en sí viven en <see cref="SessionTransaction"/>,
/// que es de quien es la conexión. Lo que añade este servicio es lo que solo se
/// puede decidir con la sesión delante: quién puede abrirla, qué se le enseña al
/// usuario y **cuándo se deshace sola**.
/// </summary>
public sealed class TransactionService
{
    /// <summary>
    /// Cuánto puede estar una transacción sin que pase nada antes de deshacerse.
    ///
    /// Quince minutos es lo que dura una interrupción normal sin que nadie note
    /// nada; una hora de comida con filas bloqueadas se nota en toda la empresa.
    /// No se mide desde que se abrió sino desde la última actividad: quien lleva
    /// media hora trabajando dentro de una no ha olvidado nada.
    /// </summary>
    public static readonly TimeSpan DefaultIdleTimeout = TimeSpan.FromMinutes(15);

    private readonly IProviderRegistry _providers;
    private readonly ISessionRegistry _sessions;
    private readonly TimeSpan _idleTimeout;

    /// <summary>
    /// Sesiones a las que se les deshizo la transacción por inactividad.
    ///
    /// Se guarda aquí y no en la transacción porque hay que contarlo justo cuando
    /// ya no existe ninguna: la transacción se llevó consigo su propio estado.
    /// </summary>
    private readonly ConcurrentDictionary<Guid, DateTimeOffset> _autoRolledBack = new();

    /// <summary>
    /// Se construye una sola vez para todo el proceso, no una por petición: el
    /// aviso de que una transacción se deshizo sola tiene que sobrevivir a la
    /// petición en la que se descubrió, porque el usuario que debe leerlo no
    /// estaba delante cuando pasó. Por eso trabaja contra el registro de sesiones
    /// y no contra `ConnectionService`, que dura lo que dura una petición.
    /// </summary>
    public TransactionService(
        IProviderRegistry providers,
        ISessionRegistry sessions,
        TimeSpan? idleTimeout = null)
    {
        _providers = providers;
        _sessions = sessions;
        _idleTimeout = idleTimeout ?? DefaultIdleTimeout;
    }

    /// <summary>Abre una transacción manual en la conexión de la sesión.</summary>
    public async Task<TransactionState> BeginAsync(Guid sessionId, CancellationToken cancellationToken)
    {
        using var turn = await _sessions.EnterAsync(sessionId, cancellationToken);

        var session = Require(sessionId);

        // En una conexión de solo lectura no hay nada que confirmar ni que
        // deshacer, y la transacción abierta seguiría reteniendo recursos del
        // servidor a cambio de nada.
        if (session.Profile.ReadOnly)
        {
            throw new TransactionRejectedException(new TransactionRejection(
                TransactionRefusal.ReadOnlyConnection,
                "La conexión está marcada como solo lectura: no hay cambios que confirmar."));
        }

        if (session.Transaction.IsOpen)
        {
            throw new TransactionRejectedException(new TransactionRejection(
                TransactionRefusal.AlreadyOpen,
                "Ya hay una transacción abierta en esta conexión. " +
                "Confírmala o deshazla antes de abrir otra."));
        }

        await session.Transaction.BeginAsync(cancellationToken);

        // Lo que se deshizo solo ya se contó; a partir de aquí estorba.
        _autoRolledBack.TryRemove(sessionId, out _);

        return Describe(session);
    }

    /// <summary>Confirma la transacción abierta.</summary>
    public Task<TransactionState> CommitAsync(Guid sessionId, CancellationToken cancellationToken) =>
        FinishAsync(sessionId, commit: true, cancellationToken);

    /// <summary>Deshace la transacción abierta.</summary>
    public Task<TransactionState> RollbackAsync(Guid sessionId, CancellationToken cancellationToken) =>
        FinishAsync(sessionId, commit: false, cancellationToken);

    /// <summary>
    /// El estado actual, sin tocar el motor.
    ///
    /// No pide turno: solo lee lo que la propia sesión ya tiene en memoria, y la
    /// interfaz lo consulta a menudo para mantener vivo el indicador. Pedirlo la
    /// pondría a hacer cola detrás de la consulta que esté corriendo, que es
    /// justo cuando más interesa poder enseñar que hay una transacción abierta.
    /// </summary>
    public TransactionState Get(Guid sessionId) => Describe(Require(sessionId));

    /// <summary>
    /// Deshace las transacciones que llevan demasiado tiempo sin actividad.
    ///
    /// Es lo que evita que una transacción olvidada —la pestaña abierta a la hora
    /// de comer— mantenga filas bloqueadas para todos los demás. Devuelve las que
    /// deshizo para poder contarlo.
    /// </summary>
    public async Task<IReadOnlyList<TransactionState>> RollbackIdleAsync(CancellationToken cancellationToken)
    {
        var abandoned = new List<TransactionState>();

        foreach (var session in _sessions.All)
        {
            if (!IsIdle(session))
            {
                continue;
            }

            using var turn = await _sessions.EnterAsync(session.Id, cancellationToken);

            // Se vuelve a mirar con el turno en la mano: mientras se esperaba, la
            // consulta que lo tenía ocupado pudo terminar, y esa transacción
            // acaba de tener actividad.
            if (!IsIdle(session))
            {
                continue;
            }

            await session.Transaction.RollbackAsync(cancellationToken);
            _autoRolledBack[session.Id] = DateTimeOffset.UtcNow;

            abandoned.Add(Describe(session));
        }

        Forget();

        return abandoned;
    }

    private async Task<TransactionState> FinishAsync(
        Guid sessionId,
        bool commit,
        CancellationToken cancellationToken)
    {
        using var turn = await _sessions.EnterAsync(sessionId, cancellationToken);

        var session = Require(sessionId);

        if (!session.Transaction.IsOpen)
        {
            throw new TransactionRejectedException(new TransactionRejection(
                TransactionRefusal.NotOpen,
                commit
                    ? "No hay ninguna transacción abierta que confirmar."
                    : "No hay ninguna transacción abierta que deshacer."));
        }

        if (commit)
        {
            await session.Transaction.CommitAsync(cancellationToken);
        }
        else
        {
            await session.Transaction.RollbackAsync(cancellationToken);
        }

        // Cerrarla a mano contesta por sí sola al aviso de que otra se deshizo:
        // el usuario está delante y ya sabe en qué estado está su conexión.
        _autoRolledBack.TryRemove(sessionId, out _);

        return Describe(session);
    }

    private IDatabaseSession Require(Guid sessionId) =>
        _sessions.Find(sessionId) ?? throw new SessionNotFoundException(sessionId);

    private bool IsIdle(IDatabaseSession session)
    {
        if (!session.Transaction.IsOpen)
        {
            return false;
        }

        // Sin tiempo de espera no se deshace nada: es el modo en el que solo
        // manda el usuario.
        if (_idleTimeout < TimeSpan.Zero)
        {
            return false;
        }

        var last = session.Transaction.LastActivityAt ?? session.Transaction.StartedAt;

        return last is null || DateTimeOffset.UtcNow - last >= _idleTimeout;
    }

    /// <summary>Olvida los avisos de sesiones que ya se cerraron.</summary>
    private void Forget()
    {
        foreach (var sessionId in _autoRolledBack.Keys)
        {
            if (_sessions.Find(sessionId) is null)
            {
                _autoRolledBack.TryRemove(sessionId, out _);
            }
        }
    }

    private TransactionState Describe(IDatabaseSession session) => new()
    {
        SessionId = session.Id,
        IsOpen = session.Transaction.IsOpen,
        StartedAt = session.Transaction.StartedAt,
        LastActivityAt = session.Transaction.LastActivityAt,
        ConnectionName = session.Profile.Name,
        Database = session.Profile.Database,
        Engine = session.Engine,
        DdlIsReversible = _providers.GetTableDesigner(session.Engine).SupportsTransactionalDdl,
        IdleTimeoutSeconds = (int)_idleTimeout.TotalSeconds,
        AutoRolledBackAt = _autoRolledBack.TryGetValue(session.Id, out var at) ? at : null,
    };
}
