using System.Data.Common;

namespace Druse.Database.Abstractions;

/// <summary>
/// La transacción bajo la que corre una operación que escribe.
///
/// Resuelve una pregunta que se repite en el editor de filas y en el diseñador
/// de tablas: **¿abro una transacción o ya hay una?** Anidarlas no funciona en
/// estos motores, así que hay que elegir, y elegir mal significa o perder la
/// atomicidad o reventar con «ya hay una transacción en curso».
///
/// - Sin transacción manual, la operación abre la suya y la confirma al acabar.
///   Es el comportamiento de siempre: todo junto o nada.
/// - Con transacción manual abierta, se **une** a ella y no la confirma ni la
///   deshace: eso lo decide el usuario con los botones.
///
/// **Lo que cambia en el segundo caso, y conviene saberlo:** si la operación
/// falla a mitad, lo ya escrito se queda dentro de la transacción del usuario en
/// lugar de deshacerse solo. No es un descuido: deshacerlo exigiría un punto de
/// guardado, y tirar de la transacción entera borraría trabajo que el usuario no
/// pidió borrar. Lo que queda es recuperable —basta con pulsar Rollback— y quien
/// llama debe decirlo.
/// </summary>
public sealed class OperationScope : IAsyncDisposable
{
    private readonly DbTransaction? _owned;

    private OperationScope(DbTransaction transaction, DbTransaction? owned)
    {
        Transaction = transaction;
        _owned = owned;
    }

    /// <summary>La transacción que hay que asignar a cada comando.</summary>
    public DbTransaction Transaction { get; }

    /// <summary>
    /// La operación abrió su propia transacción, así que es suya para confirmar.
    /// Cuando es falso, la transacción es del usuario y no se toca.
    /// </summary>
    public bool IsOwned => _owned is not null;

    public static async Task<OperationScope> BeginAsync(
        DbConnection connection,
        SessionTransaction manual,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(connection);
        ArgumentNullException.ThrowIfNull(manual);

        if (manual.Current is { } open)
        {
            return new OperationScope(open, owned: null);
        }

        var owned = await connection.BeginTransactionAsync(cancellationToken);

        return new OperationScope(owned, owned);
    }

    /// <summary>Confirma solo si la transacción es de la operación.</summary>
    public Task CommitAsync(CancellationToken cancellationToken) =>
        _owned?.CommitAsync(cancellationToken) ?? Task.CompletedTask;

    /// <summary>Deshace solo si la transacción es de la operación.</summary>
    public Task RollbackAsync(CancellationToken cancellationToken) =>
        _owned?.RollbackAsync(cancellationToken) ?? Task.CompletedTask;

    public async ValueTask DisposeAsync()
    {
        if (_owned is not null)
        {
            await _owned.DisposeAsync();
        }
    }
}
