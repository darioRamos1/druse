using System.Collections;
using System.Data;
using System.Data.Common;
using System.Diagnostics.CodeAnalysis;

namespace Druse.Jdbc;

/// <summary>
/// Parámetro posicional.
///
/// JDBC solo tiene `?` y numera por posición, así que el nombre se guarda por
/// compatibilidad con quien lo use, pero **lo que decide dónde va cada valor es
/// el orden** en el que se añadieron.
/// </summary>
public sealed class JdbcParameter : DbParameter
{
    public override DbType DbType { get; set; } = DbType.String;

    public override ParameterDirection Direction { get; set; } = ParameterDirection.Input;

    public override bool IsNullable { get; set; } = true;

    [AllowNull]
    public override string ParameterName { get; set; } = string.Empty;

    [AllowNull]
    public override string SourceColumn { get; set; } = string.Empty;

    public override bool SourceColumnNullMapping { get; set; }

    public override int Size { get; set; }

    public override object? Value { get; set; }

    public override void ResetDbType() => DbType = DbType.String;
}

/// <summary>Los parámetros de un comando, en el orden en que se añadieron.</summary>
public sealed class JdbcParameterCollection : DbParameterCollection, IReadOnlyList<JdbcParameter>
{
    private readonly List<JdbcParameter> _items = [];

    public override int Count => _items.Count;

    public override object SyncRoot { get; } = new();

    public override int Add(object value)
    {
        _items.Add(Comprobar(value));

        return _items.Count - 1;
    }

    public override void AddRange(Array values)
    {
        foreach (var value in values)
        {
            Add(value);
        }
    }

    public override void Clear() => _items.Clear();

    public override bool Contains(object value) => value is JdbcParameter p && _items.Contains(p);

    public override bool Contains(string value) => IndexOf(value) >= 0;

    public override void CopyTo(Array array, int index) => ((ICollection)_items).CopyTo(array, index);

    public override IEnumerator GetEnumerator() => _items.GetEnumerator();

    /// <summary>
    /// Acceso tipado.
    ///
    /// Explícito de la interfaz y no público: la clase base ya tiene un
    /// indexador que devuelve `DbParameter`, y declarar otro encima solo
    /// obligaría a elegir cuál se ve desde fuera.
    /// </summary>
    JdbcParameter IReadOnlyList<JdbcParameter>.this[int index] => _items[index];

    IEnumerator<JdbcParameter> IEnumerable<JdbcParameter>.GetEnumerator() => _items.GetEnumerator();

    public override int IndexOf(object value) =>
        value is JdbcParameter p ? _items.IndexOf(p) : -1;

    public override int IndexOf(string parameterName) =>
        _items.FindIndex(p => string.Equals(p.ParameterName, parameterName, StringComparison.Ordinal));

    public override void Insert(int index, object value) => _items.Insert(index, Comprobar(value));

    public override void Remove(object value)
    {
        if (value is JdbcParameter p)
        {
            _items.Remove(p);
        }
    }

    public override void RemoveAt(int index) => _items.RemoveAt(index);

    public override void RemoveAt(string parameterName)
    {
        var index = IndexOf(parameterName);

        if (index >= 0)
        {
            _items.RemoveAt(index);
        }
    }

    protected override DbParameter GetParameter(int index) => _items[index];

    protected override DbParameter GetParameter(string parameterName)
    {
        var index = IndexOf(parameterName);

        return index >= 0
            ? _items[index]
            : throw new ArgumentOutOfRangeException(
                nameof(parameterName),
                $"No hay ningún parámetro «{parameterName}».");
    }

    protected override void SetParameter(int index, DbParameter value) =>
        _items[index] = Comprobar(value);

    protected override void SetParameter(string parameterName, DbParameter value)
    {
        var index = IndexOf(parameterName);

        if (index < 0)
        {
            Add(value);
            return;
        }

        _items[index] = Comprobar(value);
    }

    private static JdbcParameter Comprobar(object value) =>
        value as JdbcParameter
        ?? throw new ArgumentException("Se esperaba un parámetro JDBC.", nameof(value));
}
