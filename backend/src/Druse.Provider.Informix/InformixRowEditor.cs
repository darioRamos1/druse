using System.Data.Common;
using System.Globalization;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.Informix;

/// <summary>Escribe cambios de filas en Informix. Solo aporta su dialecto.</summary>
public sealed class InformixRowEditor : RowEditorBase
{
    public override DatabaseEngine Engine => DatabaseEngine.Informix;

    /// <summary>
    /// Comillas dobles, duplicándolas por dentro.
    ///
    /// Solo funcionan como delimitador de identificador si la conexión lleva
    /// `DELIMIDENT=Y`; sin eso, Informix las trataría como comillas de cadena. Lo
    /// pone <see cref="InformixConnectionStringFactory"/>, y de ahí depende que
    /// una columna pueda llamarse `order` o llevar acentos.
    /// </summary>
    protected override string Quote(string identifier) =>
        $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";

    /// <summary>
    /// Informix usa marcadores posicionales: en el SQL todos son `?` y el enlace
    /// se hace por el orden en que se añaden al comando.
    /// </summary>
    protected override string Parameter(int index) => "?";

    /// <summary>
    /// Aunque el marcador sea siempre el mismo, cada parámetro necesita un nombre
    /// distinto para poder convivir en la colección del comando.
    /// </summary>
    protected override string ParameterName(int index) =>
        $"p{index.ToString(CultureInfo.InvariantCulture)}";

    /// <summary>
    /// El driver de IBM no conoce `DateOnly` ni `TimeOnly`.
    ///
    /// Son los tipos con los que el resto de Druse representa una fecha y una
    /// hora sueltas, y los otros tres motores los aceptan tal cual. Aquí el
    /// driver revienta con un «Specified cast is not valid» que no dice de qué
    /// columna habla, así que se traducen a los tipos de siempre antes de
    /// entregárselos: es la misma fecha, escrita como el driver la entiende.
    /// </summary>
    protected override void Bind(DbCommand command, string name, PreparedCell cell)
    {
        ArgumentNullException.ThrowIfNull(cell);

        base.Bind(command, name, cell.Value switch
        {
            DateOnly date => cell with { Value = date.ToDateTime(TimeOnly.MinValue) },
            TimeOnly time => cell with { Value = time.ToTimeSpan() },
            _ => cell,
        });
    }

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is InformixSession informix
            ? informix.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor Informix.",
                nameof(session));

    /// <summary>
    /// Un `MERGE`, como en SQL Server, pero con la fila de origen leída de
    /// `sysmaster:sysdual`.
    ///
    /// Informix no tiene la forma `USING (VALUES (...))`: el origen de un `MERGE`
    /// tiene que ser una consulta, así que la fila se construye con un `SELECT`
    /// de una tabla de una sola fila, que es para lo que existe `sysdual`.
    ///
    /// **Cada valor va con su `CAST`.** Un `?` suelto dentro de ese `SELECT` no
    /// tiene de dónde deducir el tipo —no está comparándose con ninguna columna— y
    /// el servidor responde que no puede resolverlo. El tipo sale de la columna a
    /// la que va, que es justo lo que la celda ya trae para poder mandar nulos.
    /// </summary>
    protected override string WriteStatement(
        PreparedInsertBatch batch,
        IReadOnlyList<PreparedCell> row,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns,
        bool literal)
    {
        ArgumentNullException.ThrowIfNull(batch);
        ArgumentNullException.ThrowIfNull(row);
        ArgumentNullException.ThrowIfNull(keyColumns);

        if (onExisting == ExistingRowAction.Fail)
        {
            return base.WriteStatement(batch, row, onExisting, keyColumns, literal);
        }

        var target = batch.Schema is null
            ? Quote(batch.Table)
            : $"{Quote(batch.Schema)}.{Quote(batch.Table)}";

        var columns = string.Join(", ", batch.Columns.Select(Quote));

        var source = string.Join(
            ", ",
            row.Select((cell, index) =>
            {
                var value = literal ? cell.Literal : Parameter(index);
                var typed = cell.DataType is { Length: > 0 } type ? $"CAST({value} AS {type})" : value;

                return $"{typed} AS {Quote(cell.Column)}";
            }));

        // `NULL = NULL` es desconocido, así que una clave con nulos no encontraría
        // la fila que sí está. Es raro en una clave primaria y corriente en una
        // restricción de unicidad.
        var on = string.Join(
            " AND ",
            keyColumns.Select(column =>
                $"(t.{Quote(column)} = s.{Quote(column)} " +
                $"OR (t.{Quote(column)} IS NULL AND s.{Quote(column)} IS NULL))"));

        var merge =
            $"MERGE INTO {target} AS t " +
            $"USING (SELECT {source} FROM sysmaster:sysdual) AS s ON {on}";

        if (onExisting == ExistingRowAction.Update)
        {
            var updatable = Updatable(batch, keyColumns);

            if (updatable.Count > 0)
            {
                var set = string.Join(
                    ", ",
                    updatable.Select(column => $"t.{Quote(column)} = s.{Quote(column)}"));

                merge += $" WHEN MATCHED THEN UPDATE SET {set}";
            }
        }

        var inserted = string.Join(", ", batch.Columns.Select(column => $"s.{Quote(column)}"));

        return $"{merge} WHEN NOT MATCHED THEN INSERT ({columns}) VALUES ({inserted})";
    }
}
