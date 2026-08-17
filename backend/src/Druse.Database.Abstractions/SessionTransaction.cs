using System.Data.Common;

namespace Druse.Database.Abstractions;

/// <summary>
/// La transacción manual de una sesión, si la hay.
///
/// Vive **entre peticiones**: se abre en una y se confirma o se deshace en otra,
/// a diferencia de las transacciones internas del editor de filas o del
/// diseñador, que nacen y mueren dentro de la misma operación.
///
/// Está aquí y no repetida en cada proveedor porque no es dialecto: abrir dos a
/// la vez, confirmar una que no existe o dejarla viva al cerrar la sesión son
/// errores iguales en los cuatro motores, y cuatro copias de estas reglas
/// acabarían separándose.
///
/// **No es segura entre hilos por sí sola.** Se apoya en el turno exclusivo por
/// sesión: quien la toca ya tiene ese turno.
/// </summary>
public sealed class SessionTransaction
{
    private readonly DbConnection? _connection;
    private DbTransaction? _transaction;

    public SessionTransaction(DbConnection connection) => _connection = connection;

    private SessionTransaction() => _connection = null;

    /// <summary>
    /// Para sesiones que no hablan con ningún motor.
    ///
    /// Existe por los dobles de las pruebas: la interfaz exige una transacción y
    /// una sesión falsa no tiene conexión donde abrirla. Intentar usarla falla
    /// con un mensaje claro en lugar de con una referencia nula.
    /// </summary>
    public static SessionTransaction None { get; } = new();

    /// <summary>La transacción abierta, o `null` si se trabaja en autocommit.</summary>
    public DbTransaction? Current => _transaction;

    public bool IsOpen => _transaction is not null;

    /// <summary>
    /// Cuándo se abrió.
    ///
    /// Sirve para dos cosas que el usuario agradece: enseñar cuánto lleva abierta
    /// y deshacerla sola si se olvidó. Una transacción olvidada mantiene filas
    /// bloqueadas para todo el mundo.
    /// </summary>
    public DateTimeOffset? StartedAt { get; private set; }

    /// <summary>
    /// La última vez que algo pasó por esta transacción.
    ///
    /// Lo que se deshace sola es la transacción **inactiva**, no la larga: quien
    /// está trabajando dentro de una desde hace media hora no ha olvidado nada, y
    /// tirársela sería peor que el bloqueo que se intenta evitar.
    /// </summary>
    public DateTimeOffset? LastActivityAt { get; private set; }

    /// <summary>
    /// Anota que se usó, para que el temporizador vuelva a contar desde cero.
    ///
    /// Lo llama la capa de aplicación después de cada operación que fue por esta
    /// conexión. Si no hay transacción abierta no hace nada: sin ella no hay
    /// nada que deshacer y nada que contar.
    /// </summary>
    public void Touch()
    {
        if (_transaction is not null)
        {
            LastActivityAt = DateTimeOffset.UtcNow;
        }
    }

    public async Task BeginAsync(CancellationToken cancellationToken)
    {
        if (_transaction is not null)
        {
            throw new InvalidOperationException("Ya hay una transacción abierta en esta conexión.");
        }

        if (_connection is null)
        {
            throw new InvalidOperationException("Esta sesión no tiene una conexión sobre la que abrir una transacción.");
        }

        _transaction = await _connection.BeginTransactionAsync(cancellationToken);
        StartedAt = DateTimeOffset.UtcNow;
        LastActivityAt = StartedAt;
    }

    public async Task CommitAsync(CancellationToken cancellationToken)
    {
        var transaction = Require();

        await transaction.CommitAsync(cancellationToken);
        await Clear(transaction);
    }

    public async Task RollbackAsync(CancellationToken cancellationToken)
    {
        var transaction = Require();

        await transaction.RollbackAsync(cancellationToken);
        await Clear(transaction);
    }

    /// <summary>
    /// Deshace lo que quede abierto al cerrar la sesión.
    ///
    /// Cerrar la conexión con una transacción viva la deshace igualmente, pero
    /// hacerlo aquí de forma explícita evita depender de ese comportamiento y
    /// deja claro qué pasa con los cambios sin confirmar: se pierden.
    /// </summary>
    public async ValueTask DisposeAsync()
    {
        if (_transaction is null)
        {
            return;
        }

        try
        {
            await _transaction.RollbackAsync(CancellationToken.None);
        }
        catch
        {
            // Si la conexión ya se cayó, no hay nada que deshacer y tampoco nadie
            // a quien contárselo: la sesión se está cerrando.
        }

        await Clear(_transaction);
    }

    private DbTransaction Require() =>
        _transaction ?? throw new InvalidOperationException(
            "No hay ninguna transacción abierta en esta conexión.");

    private async Task Clear(DbTransaction transaction)
    {
        _transaction = null;
        StartedAt = null;
        LastActivityAt = null;
        await transaction.DisposeAsync();
    }
}
