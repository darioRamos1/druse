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
    private readonly java.sql.ResultSet _rs;
    private readonly java.sql.Statement _statement;
    private readonly JdbcConnection? _cerrarTambien;
    private readonly java.sql.ResultSetMetaData _meta;
    private bool _cerrado;

    internal JdbcDataReader(
        java.sql.ResultSet rs,
        java.sql.Statement statement,
        JdbcConnection? cerrarTambien)
    {
        _rs = rs;
        _statement = statement;
        _cerrarTambien = cerrarTambien;
        _meta = rs.getMetaData();
        FieldCount = _meta.getColumnCount();
    }

    public override int FieldCount { get; }

    public override bool HasRows => true;

    public override bool IsClosed => _cerrado;

    public override int Depth => 0;

    /// <summary>
    /// Filas afectadas.
    ///
    /// Siempre -1: quien lee un resultado no está contando escrituras, y JDBC no
    /// ofrece el dato desde un `ResultSet`.
    /// </summary>
    public override int RecordsAffected => -1;

    public override object this[int ordinal] => GetValue(ordinal);

    public override object this[string name] => GetValue(GetOrdinal(name));

    public override bool Read()
    {
        try
        {
            return _rs.next();
        }
        catch (java.sql.SQLException exception)
        {
            throw new JdbcException(exception);
        }
    }

    public override Task<bool> ReadAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();

        return Task.FromResult(Read());
    }

    public override bool NextResult() => false;

    public override string GetName(int ordinal) => _meta.getColumnLabel(Ordinal(ordinal)) ?? string.Empty;

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
        _meta.getColumnTypeName(Ordinal(ordinal)) ?? string.Empty;

    public override Type GetFieldType(int ordinal) => Traducir(_meta.getColumnType(Ordinal(ordinal)));

    public override bool IsDBNull(int ordinal)
    {
        _rs.getObject(Ordinal(ordinal));

        return _rs.wasNull();
    }

    public override object GetValue(int ordinal)
    {
        var valor = _rs.getObject(Ordinal(ordinal));

        if (valor is null || _rs.wasNull())
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

    public override bool GetBoolean(int ordinal) => _rs.getBoolean(Ordinal(ordinal));

    public override byte GetByte(int ordinal) => (byte)_rs.getShort(Ordinal(ordinal));

    public override char GetChar(int ordinal)
    {
        var texto = GetString(ordinal);

        return texto.Length > 0 ? texto[0] : '\0';
    }

    public override DateTime GetDateTime(int ordinal)
    {
        var marca = _rs.getTimestamp(Ordinal(ordinal));

        // `toString` da el formato ISO de JDBC, que `DateTime.Parse` entiende sin
        // ambigüedad de idioma. Pasar por los milisegundos de época obligaría a
        // decidir una zona horaria que nadie ha pedido.
        return marca is null
            ? default
            : DateTime.Parse(marca.toString(), System.Globalization.CultureInfo.InvariantCulture);
    }

    public override decimal GetDecimal(int ordinal)
    {
        var valor = _rs.getBigDecimal(Ordinal(ordinal));

        return valor is null
            ? 0m
            : decimal.Parse(valor.toString(), System.Globalization.CultureInfo.InvariantCulture);
    }

    public override double GetDouble(int ordinal) => _rs.getDouble(Ordinal(ordinal));

    public override float GetFloat(int ordinal) => _rs.getFloat(Ordinal(ordinal));

    public override Guid GetGuid(int ordinal) => Guid.Parse(GetString(ordinal));

    public override short GetInt16(int ordinal) => _rs.getShort(Ordinal(ordinal));

    public override int GetInt32(int ordinal) => _rs.getInt(Ordinal(ordinal));

    public override long GetInt64(int ordinal) => _rs.getLong(Ordinal(ordinal));

    public override string GetString(int ordinal) => _rs.getString(Ordinal(ordinal)) ?? string.Empty;

    public override long GetBytes(int ordinal, long dataOffset, byte[]? buffer, int bufferOffset, int length)
    {
        var bytes = _rs.getBytes(Ordinal(ordinal));

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

        Silencioso(() => _rs.close());
        Silencioso(() => _statement.close());

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
