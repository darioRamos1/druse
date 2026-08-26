using System.Data;
using System.Data.Common;

namespace Druse.Jdbc;

/// <summary>
/// Transacción manual sobre una conexión JDBC.
///
/// En JDBC no hay objeto transacción: se apaga el autocommit y se confirma o se
/// deshace sobre la propia conexión. Esta clase existe para que quien esté
/// arriba siga viendo la forma de ADO.NET, y para devolver el autocommit a su
/// sitio al terminar — olvidarlo dejaría la conexión en un modo que nadie pidió
/// y que solo se nota mucho después.
/// </summary>
public sealed class JdbcTransaction : DbTransaction
{
    private readonly JdbcConnection _connection;
    private bool _terminada;

    internal JdbcTransaction(JdbcConnection connection, IsolationLevel isolationLevel)
    {
        _connection = connection;
        IsolationLevel = isolationLevel;
    }

    public override IsolationLevel IsolationLevel { get; }

    protected override DbConnection DbConnection => _connection;

    public override void Commit() => Terminar(java => java.commit());

    public override void Rollback() => Terminar(java => java.rollback());

    protected override void Dispose(bool disposing)
    {
        // Lo que no se confirmó se deshace, que es lo que espera cualquiera que
        // salga de un `using` sin haber llamado a Commit.
        if (disposing && !_terminada)
        {
            try
            {
                Rollback();
            }
            catch (DbException)
            {
                // Si la conexión ya no está, no hay nada que deshacer.
            }
        }

        base.Dispose(disposing);
    }

    private void Terminar(Action<java.sql.Connection> accion)
    {
        if (_terminada)
        {
            throw new InvalidOperationException("Esta transacción ya se cerró.");
        }

        var java = _connection.Java;

        try
        {
            accion(java);
        }
        catch (java.sql.SQLException exception)
        {
            throw new JdbcException(exception);
        }
        finally
        {
            _terminada = true;

            try
            {
                java.setAutoCommit(true);
            }
            catch (java.sql.SQLException)
            {
                // La conexión se está cayendo; el autocommit ya da igual.
            }
        }
    }
}
