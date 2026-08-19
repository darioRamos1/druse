using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.MySql;

/// <summary>Escribe cambios de filas en MySQL. Solo aporta su dialecto.</summary>
public sealed class MySqlRowEditor : RowEditorBase
{
    public override DatabaseEngine Engine => DatabaseEngine.MySql;

    /// <summary>
    /// Comillas invertidas, que es lo que permite en MySQL que una columna se
    /// llame `order` o `group`. La de cierre se duplica por dentro.
    /// </summary>
    protected override string Quote(string identifier) =>
        $"`{identifier.Replace("`", "``", StringComparison.Ordinal)}`";

    protected override string Parameter(int index) => $"@p{index}";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is MySqlSession mysql
            ? mysql.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor MySQL.",
                nameof(session));

    /// <summary>
    /// `ON DUPLICATE KEY UPDATE`, con una diferencia que hay que conocer.
    ///
    /// **MySQL no deja decir con qué clave se choca**: reacciona ante cualquier
    /// clave única de la tabla, no solo ante las columnas elegidas. Si la tabla
    /// tiene otra restricción de unicidad, una fila puede acabar actualizando a
    /// otra que no comparte la clave que el usuario nombró. No se puede arreglar
    /// desde aquí —no hay sintaxis para ello— así que se avisa antes de escribir,
    /// que es lo único honesto.
    ///
    /// `VALUES(col)` está desaconsejado desde MySQL 8.0.20 en favor de un alias de
    /// fila, pero MariaDB no admite ese alias y aquí los dos usan el mismo
    /// proveedor.
    /// </summary>
    protected override string ConflictClause(
        PreparedInsertBatch batch,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns)
    {
        ArgumentNullException.ThrowIfNull(batch);
        ArgumentNullException.ThrowIfNull(keyColumns);

        var updatable = Updatable(batch, keyColumns);

        if (updatable.Count == 0)
        {
            // Sin columnas que cambiar, actualizar es no hacer nada; se dice
            // asignando una columna a sí misma, porque un `SET` vacío no compila.
            var untouched = Quote(keyColumns.Count > 0 ? keyColumns[0] : batch.Columns[0]);

            return $"ON DUPLICATE KEY UPDATE {untouched} = {untouched}";
        }

        var set = string.Join(
            ", ",
            updatable.Select(column => $"{Quote(column)} = VALUES({Quote(column)})"));

        return $"ON DUPLICATE KEY UPDATE {set}";
    }

    /// <summary>
    /// Omitir lo que ya está es `INSERT IGNORE`, y no una cláusula al final.
    ///
    /// La forma elegante —`ON DUPLICATE KEY UPDATE col = col`— **no sirve aquí, y
    /// el motivo no es de dialecto sino del cliente**: MySqlConnector cuenta por
    /// omisión filas *encontradas* y no filas *afectadas*, así que una fila que ya
    /// estaba devuelve uno igualmente y se contaría como escrita. El recuento es
    /// justo la mitad del valor de este modo, así que hay que poder confiar en él.
    ///
    /// **Lo que cuesta**: `IGNORE` también degrada a aviso algún error de datos
    /// —un texto que no cabe se recorta en vez de fallar—. Aquí eso es asumible
    /// porque los valores llegan ya convertidos contra los tipos de la tabla de
    /// destino, que es donde se caza lo que no cabe; en los otros tres motores no
    /// hace falta el intercambio.
    /// </summary>
    protected override string WriteStatement(
        PreparedInsertBatch batch,
        IReadOnlyList<PreparedCell> row,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns,
        bool literal)
    {
        if (onExisting != ExistingRowAction.Skip)
        {
            return base.WriteStatement(batch, row, onExisting, keyColumns, literal);
        }

        // El `INSERT` a secas, sin cláusula de conflicto: la que añadiría el modo
        // de actualizar es justo lo que aquí no se quiere.
        var insert = base.WriteStatement(batch, row, ExistingRowAction.Fail, keyColumns, literal);

        return "INSERT IGNORE" + insert["INSERT".Length..];
    }
}
