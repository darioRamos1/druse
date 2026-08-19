using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.SqlServer;

/// <summary>Escribe cambios de filas en SQL Server. Solo aporta su dialecto.</summary>
public sealed class SqlServerRowEditor : RowEditorBase
{
    public override DatabaseEngine Engine => DatabaseEngine.SqlServer;

    /// <summary>
    /// Corchetes, que es como SQL Server admite cualquier nombre.
    ///
    /// El corchete de cierre se duplica: sin eso, una tabla llamada `a]b`
    /// permitiría escapar del identificador.
    /// </summary>
    protected override string Quote(string identifier) =>
        $"[{identifier.Replace("]", "]]", StringComparison.Ordinal)}]";

    protected override string Parameter(int index) => $"@p{index}";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is SqlServerSession sqlServer
            ? sqlServer.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor SQL Server.",
                nameof(session));

    /// <summary>
    /// Aquí no hay cláusula que añadir al `INSERT`: es un `MERGE` entero.
    ///
    /// SQL Server no tiene un «inserta y si ya está, actualiza» en una línea, así
    /// que la fila entra como origen de un `MERGE` —`USING (VALUES (...))`— y las
    /// dos ramas dicen qué hacer en cada caso. Los valores siguen yendo una sola
    /// vez, dentro del `USING`, así que no hay que repetir los parámetros.
    ///
    /// La condición se escribe columna a columna con `IS NULL` contemplado: en un
    /// `MERGE`, `NULL = NULL` es desconocido, y una clave con nulos dejaría de
    /// encontrar la fila que sí está. Es raro en una clave primaria y corriente en
    /// una restricción de unicidad.
    ///
    /// **El punto y coma final no es cosmético**: SQL Server rechaza un `MERGE`
    /// que no lo lleve.
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
        var values = string.Join(
            ", ",
            row.Select((cell, index) => literal ? cell.Literal : Parameter(index)));

        var on = string.Join(
            " AND ",
            keyColumns.Select(column =>
                $"(t.{Quote(column)} = s.{Quote(column)} " +
                $"OR (t.{Quote(column)} IS NULL AND s.{Quote(column)} IS NULL))"));

        var merge =
            $"MERGE INTO {target} AS t USING (VALUES ({values})) AS s ({columns}) ON {on}";

        if (onExisting == ExistingRowAction.Update)
        {
            var updatable = Updatable(batch, keyColumns);

            // Sin columnas que cambiar, la rama de actualizar sobra: un `SET`
            // vacío no compila, y no escribirla deja el mismo resultado.
            if (updatable.Count > 0)
            {
                var set = string.Join(
                    ", ",
                    updatable.Select(column => $"t.{Quote(column)} = s.{Quote(column)}"));

                merge += $" WHEN MATCHED THEN UPDATE SET {set}";
            }
        }

        var inserted = string.Join(", ", batch.Columns.Select(column => $"s.{Quote(column)}"));

        return $"{merge} WHEN NOT MATCHED THEN INSERT ({columns}) VALUES ({inserted});";
    }
}
