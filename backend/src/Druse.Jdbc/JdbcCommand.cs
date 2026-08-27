using System.Data;
using System.Data.Common;
using System.Diagnostics.CodeAnalysis;

namespace Druse.Jdbc;

/// <summary>
/// Comando ADO.NET sobre `java.sql`.
///
/// Se usa siempre `PreparedStatement`, incluso sin parámetros: es lo que permite
/// que los valores viajen tipados en vez de pegados al texto, que es la
/// diferencia entre parametrizar y concatenar.
/// </summary>
public sealed class JdbcCommand : DbCommand
{
    private readonly JdbcParameterCollection _parameters = new();
    private JdbcConnection? _connection;
    /// <summary>
    /// El statement que está corriendo ahora mismo.
    ///
    /// No es «el último preparado»: en un lote se preparan varios y solo uno
    /// está en el motor. Cancelar el equivocado no haría nada y dejaría la
    /// consulta viva, que es la peor forma de fallar —parece que funcionó—.
    ///
    /// `volatile` porque lo escribe el hilo que ejecuta y lo lee el que cancela.
    /// </summary>
    private volatile java.sql.PreparedStatement? _enCurso;

    [AllowNull]
    public override string CommandText { get; set; } = string.Empty;

    public override int CommandTimeout { get; set; } = 30;

    public override CommandType CommandType { get; set; } = CommandType.Text;

    public override bool DesignTimeVisible { get; set; }

    public override UpdateRowSource UpdatedRowSource { get; set; } = UpdateRowSource.None;

    protected override DbConnection? DbConnection
    {
        get => _connection;
        set => _connection = value as JdbcConnection
            ?? (value is null
                ? null
                : throw new ArgumentException("Se esperaba una conexión JDBC.", nameof(value)));
    }

    protected override DbParameterCollection DbParameterCollection => _parameters;

    protected override DbTransaction? DbTransaction { get; set; }

    public override void Cancel()
    {
        // JDBC sí permite cancelar desde otro hilo, que es justo lo que hace
        // falta para el botón «Cancelar» de una consulta larga.
        try
        {
            _enCurso?.cancel();
        }
        catch (java.sql.SQLException)
        {
            // Cancelar lo que ya terminó no es un error.
        }
    }

    public override int ExecuteNonQuery()
    {
        var total = 0;

        // Una por una: JDBC no acepta varias sentencias en el mismo statement, y
        // lo que se devuelve es la suma, como haría un lote de ADO.NET.
        foreach (var sentencia in SqlBatch.Split(CommandText))
        {
            using var statement = Preparar(sentencia);

            try
            {
                total += statement.executeUpdate();
            }
            catch (java.sql.SQLException exception)
            {
                throw new JdbcException(exception);
            }
        }

        return total;
    }

    public override object? ExecuteScalar()
    {
        var sentencias = SqlBatch.Split(CommandText);

        // La primera que haya: un escalar se pide de una consulta, no de un
        // guion, y ejecutar el resto sería hacer trabajo que nadie pidió.
        using var statement = Preparar(sentencias.Count > 0 ? sentencias[0] : CommandText);

        try
        {
            if (!statement.execute())
            {
                return null;
            }

            using var rs = statement.getResultSet();

            return rs.next() ? rs.getObject(1) : null;
        }
        catch (java.sql.SQLException exception)
        {
            throw new JdbcException(exception);
        }
    }

    public override void Prepare()
    {
        // `Preparar` ya lo hace en cada ejecución; adelantarlo aquí solo dejaría
        // un statement vivo sin nadie que lo cierre.
    }

    /// <summary>
    /// Abre el lector sin bloquear al que espera.
    ///
    /// Es la ruta que usa Druse, y la única por la que la cancelación llega a
    /// tiempo: la versión síncrona se queda dentro del driver hasta que el
    /// servidor conteste.
    /// </summary>
    protected override Task<DbDataReader> ExecuteDbDataReaderAsync(
        CommandBehavior behavior,
        CancellationToken cancellationToken) =>
        JdbcCancellation.RunAsync(
            () => ExecuteDbDataReader(behavior),
            Cancel,
            cancellationToken);

    public override Task<int> ExecuteNonQueryAsync(CancellationToken cancellationToken) =>
        JdbcCancellation.RunAsync(ExecuteNonQuery, Cancel, cancellationToken);

    public override Task<object?> ExecuteScalarAsync(CancellationToken cancellationToken) =>
        JdbcCancellation.RunAsync(ExecuteScalar, Cancel, cancellationToken);

    protected override DbDataReader ExecuteDbDataReader(CommandBehavior behavior)
    {
        var sentencias = SqlBatch.Split(CommandText);

        if (sentencias.Count == 0)
        {
            sentencias = [CommandText];
        }

        // El lector va abriendo cada sentencia al avanzar con `NextResult`, que
        // es como ADO.NET recorre un lote. Ejecutarlas todas aquí obligaría a
        // guardar en memoria resultados que quizá nadie llegue a leer.
        return new JdbcDataReader(
            sentencias,
            Preparar,
            behavior.HasFlag(CommandBehavior.CloseConnection) ? _connection : null,
            Cancel);
    }

    /// <summary>Prepara una sentencia suelta con los parámetros del comando.</summary>
    internal java.sql.PreparedStatement Preparar(string sentencia)
    {
        if (_connection is null)
        {
            throw new InvalidOperationException("El comando no tiene conexión.");
        }

        try
        {
            var statement = _connection.Java.prepareStatement(sentencia);

            // En JDBC el plazo va en segundos y cero significa «sin límite», igual
            // que en ADO.NET.
            statement.setQueryTimeout(Math.Max(0, CommandTimeout));

            for (var i = 0; i < _parameters.Count; i++)
            {
                var parametro = (JdbcParameter)_parameters[i];

                if (parametro.Value is null || parametro.Value == DBNull.Value)
                {
                    statement.setNull(i + 1, java.sql.Types.VARCHAR);
                }
                else
                {
                    statement.setObject(i + 1, ToJava(parametro.Value));
                }
            }

            _enCurso = statement;

            return statement;
        }
        catch (java.sql.SQLException exception)
        {
            throw new JdbcException(exception);
        }
    }

    /// <summary>
    /// Lleva un valor de .NET al objeto que espera el driver.
    ///
    /// Los que no tienen equivalente directo se mandan como texto y que el motor
    /// los convierta: es lo que hace el propio JDBC con los tipos que no conoce,
    /// y evita inventar conversiones que solo se verían fallar en producción.
    /// </summary>
    private static object ToJava(object value) => value switch
    {
        string s => s,
        int i => java.lang.Integer.valueOf(i),
        long l => java.lang.Long.valueOf(l),
        short s => java.lang.Short.valueOf(s),
        bool b => java.lang.Boolean.valueOf(b),
        double d => java.lang.Double.valueOf(d),
        float f => java.lang.Float.valueOf(f),
        decimal m => new java.math.BigDecimal(m.ToString(System.Globalization.CultureInfo.InvariantCulture)),
        DateTime fecha => java.sql.Timestamp.valueOf(fecha.ToString("yyyy-MM-dd HH:mm:ss.fff", System.Globalization.CultureInfo.InvariantCulture)),
        byte[] bytes => bytes,
        _ => value.ToString() ?? string.Empty,
    };

    protected override DbParameter CreateDbParameter() => new JdbcParameter();
}
