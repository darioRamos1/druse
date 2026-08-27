using System.Collections;
using System.Data;
using System.Data.Common;

namespace Druse.Jdbc;

/// <summary>
/// Lector ADO.NET sobre un `ResultSet` de JDBC.
///
/// Las dos APIs cuentan las columnas distinto —JDBC empieza en 1, ADO.NET en
/// 0—, y ese desajuste es el origen clásico de los errores en un puente como
/// este. Aquí se traduce en un único sitio, <see cref="Ordinal"/>, para que no
/// haya que acordarse en cada método.
/// </summary>
public sealed class JdbcDataReader : DbDataReader, IEnumerable<DbDataRecord>
{
    private readonly IReadOnlyList<string> _sentencias;
    private readonly Func<string, java.sql.PreparedStatement> _preparar;
    private readonly JdbcConnection? _cerrarTambien;
    private readonly Action _cancelar;

    private java.sql.ResultSet? _rs;
    private java.sql.Statement? _statement;
    private java.sql.ResultSetMetaData? _meta;
    private int _siguiente;
    private int _afectadas = -1;
    private bool _cerrado;

    /// <summary>
    /// Recorre las sentencias del lote una a una.
    ///
    /// Se abre la primera en el constructor porque quien recibe un lector espera
    /// poder leer sin llamar antes a `NextResult`, igual que en ADO.NET. Las
    /// siguientes esperan a que se pidan: ejecutarlas por adelantado haría
    /// trabajo que quizá nadie mire, y en un guion con escrituras lo haría
    /// **antes de tiempo**.
    /// </summary>
    internal JdbcDataReader(
        IReadOnlyList<string> sentencias,
        Func<string, java.sql.PreparedStatement> preparar,
        JdbcConnection? cerrarTambien,
        Action cancelar)
    {
        _sentencias = sentencias;
        _preparar = preparar;
        _cerrarTambien = cerrarTambien;
        _cancelar = cancelar;

        Avanzar();
    }

    /// <summary>
    /// Abre la siguiente sentencia. `false` cuando ya no queda ninguna.
    ///
    /// Una sentencia que no devuelve filas —un INSERT— no interrumpe el
    /// recorrido: se anota cuántas afectó y se sigue, que es lo que espera quien
    /// manda un guion mezclando escrituras y consultas.
    /// </summary>
    private bool Avanzar()
    {
        CerrarActual();

        while (_siguiente < _sentencias.Count)
        {
            var sentencia = _sentencias[_siguiente++];
            var statement = _preparar(sentencia);

            try
            {
                if (statement.execute())
                {
                    _statement = statement;
                    _rs = statement.getResultSet();
                    _meta = Rs.getMetaData();
                    _columnas = _meta.getColumnCount();

                    return true;
                }

                var afectadas = statement.getUpdateCount();

                if (afectadas >= 0)
                {
                    _afectadas = _afectadas < 0 ? afectadas : _afectadas + afectadas;
                }

                statement.close();
            }
            catch (java.sql.SQLException exception)
            {
                statement.close();
                throw new JdbcException(exception);
            }
        }

        _columnas = 0;

        return false;
    }

    private void CerrarActual()
    {
        Silencioso(() => _rs?.close());
        Silencioso(() => _statement?.close());

        _rs = null;
        _statement = null;
        _meta = null;
    }

    /// <summary>El resultado abierto, o un error claro si ya no hay ninguno.</summary>
    private java.sql.ResultSet Rs =>
        _rs ?? throw new InvalidOperationException("No hay ningún resultado que leer.");

    private java.sql.ResultSetMetaData Meta =>
        _meta ?? throw new InvalidOperationException("No hay ningún resultado que leer.");

    private int _columnas;

    public override int FieldCount => _columnas;

    public override bool HasRows => _rs is not null;

    public override bool IsClosed => _cerrado;

    public override int Depth => 0;

    /// <summary>
    /// Filas que escribieron las sentencias del lote que no devolvían resultado.
    ///
    /// -1 cuando no hubo ninguna, que es lo que ADO.NET usa para «no aplica» y lo
    /// que distingue un guion de solo lectura de uno que escribió cero filas.
    /// </summary>
    public override int RecordsAffected => _afectadas;

    public override object this[int ordinal] => GetValue(ordinal);

    public override object this[string name] => GetValue(GetOrdinal(name));

    public override bool Read()
    {
        try
        {
            return Rs.next();
        }
        catch (java.sql.SQLException exception)
        {
            throw new JdbcException(exception);
        }
    }

    /// <summary>
    /// Lee la siguiente fila sin bloquear al que espera.
    ///
    /// Traer una fila puede tardar tanto como ejecutar: con un resultado grande,
    /// el motor va sirviendo por bloques y cada `next` es una ida y vuelta. Si
    /// esto no atendiera la cancelación, cancelar a mitad de lectura no haría
    /// nada hasta que llegara la última fila.
    /// </summary>
    public override Task<bool> ReadAsync(CancellationToken cancellationToken) =>
        JdbcCancellation.RunAsync(Read, _cancelar, cancellationToken);

    public override Task<bool> NextResultAsync(CancellationToken cancellationToken) =>
        JdbcCancellation.RunAsync(NextResult, _cancelar, cancellationToken);

    public override bool NextResult() => Avanzar();

    public override string GetName(int ordinal) => Meta.getColumnLabel(Ordinal(ordinal)) ?? string.Empty;

    public override int GetOrdinal(string name)
    {
        for (var i = 0; i < FieldCount; i++)
        {
            if (string.Equals(GetName(i), name, StringComparison.OrdinalIgnoreCase))
            {
                return i;
            }
        }

        throw new ArgumentOutOfRangeException(nameof(name), $"No hay ninguna columna «{name}».");
    }

    /// <summary>El nombre del tipo tal y como lo llama el motor, no el de Java.</summary>
    public override string GetDataTypeName(int ordinal) =>
        Meta.getColumnTypeName(Ordinal(ordinal)) ?? string.Empty;

    public override Type GetFieldType(int ordinal) => Traducir(Meta.getColumnType(Ordinal(ordinal)));

    public override bool IsDBNull(int ordinal)
    {
        Rs.getObject(Ordinal(ordinal));

        return Rs.wasNull();
    }

    public override object GetValue(int ordinal)
    {
        var valor = Rs.getObject(Ordinal(ordinal));

        if (valor is null || Rs.wasNull())
        {
            return DBNull.Value;
        }

        return DesdeJava(valor);
    }

    public override int GetValues(object[] values)
    {
        var cuantos = Math.Min(values.Length, FieldCount);

        for (var i = 0; i < cuantos; i++)
        {
            values[i] = GetValue(i);
        }

        return cuantos;
    }

    public override bool GetBoolean(int ordinal) => Rs.getBoolean(Ordinal(ordinal));

    public override byte GetByte(int ordinal) => (byte)Rs.getShort(Ordinal(ordinal));

    public override char GetChar(int ordinal)
    {
        var texto = GetString(ordinal);

        return texto.Length > 0 ? texto[0] : '\0';
    }

    public override DateTime GetDateTime(int ordinal)
    {
        var marca = Rs.getTimestamp(Ordinal(ordinal));

        // `toString` da el formato ISO de JDBC, que `DateTime.Parse` entiende sin
        // ambigüedad de idioma. Pasar por los milisegundos de época obligaría a
        // decidir una zona horaria que nadie ha pedido.
        return marca is null
            ? default
            : DateTime.Parse(marca.toString(), System.Globalization.CultureInfo.InvariantCulture);
    }

    public override decimal GetDecimal(int ordinal)
    {
        var valor = Rs.getBigDecimal(Ordinal(ordinal));

        return valor is null
            ? 0m
            : decimal.Parse(valor.toString(), System.Globalization.CultureInfo.InvariantCulture);
    }

    public override double GetDouble(int ordinal) => Rs.getDouble(Ordinal(ordinal));

    public override float GetFloat(int ordinal) => Rs.getFloat(Ordinal(ordinal));

    public override Guid GetGuid(int ordinal) => Guid.Parse(GetString(ordinal));

    public override short GetInt16(int ordinal) => Rs.getShort(Ordinal(ordinal));

    public override int GetInt32(int ordinal) => Rs.getInt(Ordinal(ordinal));

    public override long GetInt64(int ordinal) => Rs.getLong(Ordinal(ordinal));

    public override string GetString(int ordinal) => Rs.getString(Ordinal(ordinal)) ?? string.Empty;

    public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length)
    {
        var bytes = Rs.getBytes(Ordinal(ordinal));

        if (bytes is null)
        {
            return 0;
        }

        if (buffer is null)
        {
            return bytes.Length;
        }

        var cuantos = (int)Math.Min(length, bytes.Length - dataOffset);

        Array.Copy(bytes, dataOffset, buffer, bufferOffset, cuantos);

        return cuantos;
    }

    public override long GetChars(int ordinal, long dataOffset, char[]? buffer, int bufferOffset, int length)
    {
        var texto = GetString(ordinal);

        if (buffer is null)
        {
            return texto.Length;
        }

        var cuantos = (int)Math.Min(length, texto.Length - dataOffset);

        texto.CopyTo((int)dataOffset, buffer, bufferOffset, cuantos);

        return cuantos;
    }

    public override IEnumerator GetEnumerator() => new DbEnumerator(this);

    /// <summary>
    /// Recorrido tipado.
    ///
    /// Existe porque un tipo público que solo expone el `IEnumerator` sin tipo
    /// obliga a castear en cada uso. Se apoya en el mismo enumerador, así que
    /// avanza el lector: es de un solo paso, como todo lo demás aquí.
    /// </summary>
    IEnumerator<DbDataRecord> IEnumerable<DbDataRecord>.GetEnumerator()
    {
        var enumerador = GetEnumerator();

        while (enumerador.MoveNext())
        {
            yield return (DbDataRecord)enumerador.Current;
        }
    }

    public override void Close()
    {
        if (_cerrado)
        {
            return;
        }

        _cerrado = true;

        CerrarActual();

        _cerrarTambien?.Close();
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            Close();
        }

        base.Dispose(disposing);
    }

    /// <summary>De índice de ADO.NET a índice de JDBC.</summary>
    private static int Ordinal(int ordinal) => ordinal + 1;

    private static void Silencioso(Action accion)
    {
        try
        {
            accion();
        }
        catch (java.sql.SQLException)
        {
            // Cerrar lo que ya se cerró no interesa a nadie.
        }
    }

    private static object DesdeJava(object valor) => valor switch
    {
        java.lang.Integer i => i.intValue(),
        java.lang.Long l => l.longValue(),
        java.lang.Short s => s.shortValue(),
        java.lang.Boolean b => b.booleanValue(),
        java.lang.Double d => d.doubleValue(),
        java.lang.Float f => f.floatValue(),
        java.math.BigDecimal m => decimal.Parse(m.toString(), System.Globalization.CultureInfo.InvariantCulture),
        java.sql.Timestamp t => DateTime.Parse(t.toString(), System.Globalization.CultureInfo.InvariantCulture),
        java.sql.Date fecha => DateTime.Parse(fecha.toString(), System.Globalization.CultureInfo.InvariantCulture),
        byte[] bytes => bytes,
        _ => valor.ToString() ?? string.Empty,
    };

    private static Type Traducir(int tipoSql) => tipoSql switch
    {
        java.sql.Types.BIT or java.sql.Types.BOOLEAN => typeof(bool),
        java.sql.Types.TINYINT or java.sql.Types.SMALLINT => typeof(short),
        java.sql.Types.INTEGER => typeof(int),
        java.sql.Types.BIGINT => typeof(long),
        java.sql.Types.FLOAT or java.sql.Types.REAL => typeof(float),
        java.sql.Types.DOUBLE => typeof(double),
        java.sql.Types.NUMERIC or java.sql.Types.DECIMAL => typeof(decimal),
        java.sql.Types.DATE or java.sql.Types.TIME or java.sql.Types.TIMESTAMP => typeof(DateTime),
        java.sql.Types.BINARY or java.sql.Types.VARBINARY or java.sql.Types.LONGVARBINARY or java.sql.Types.BLOB => typeof(byte[]),
        _ => typeof(string),
    };
}
