using System.Data.Common;
using Druse.Database.Abstractions;
using Druse.Domain;
using Oracle.ManagedDataAccess.Client;

namespace Druse.Provider.Oracle;

/// <summary>Escribe cambios de filas en Oracle. Solo aporta su dialecto.</summary>
public sealed class OracleRowEditor : RowEditorBase
{
    public override DatabaseEngine Engine => DatabaseEngine.Oracle;

    /// <summary>
    /// Solo se cita lo que lo necesita: el porqué está en
    /// <see cref="OracleIdentifier"/>.
    /// </summary>
    protected override string Quote(string identifier) => OracleIdentifier.Quote(identifier);

    protected override string Parameter(int index) => $":p{index}";

    /// <summary>
    /// El nombre con el que se registra, **sin los dos puntos**.
    ///
    /// ODP.NET los quita si se los ponen, pero deja de encontrar el parámetro
    /// cuando además se liga por nombre. Es la clase de detalle que se manifiesta
    /// como «no se ha suministrado el parámetro» sin decir cuál.
    /// </summary>
    protected override string ParameterName(int index) => $"p{index}";

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is OracleSession oracle
            ? oracle.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor Oracle.",
                nameof(session));

    /// <summary>
    /// Liga el parámetro y, además, pone el comando a ligar por nombre.
    ///
    /// ODP.NET liga por **orden** salvo que se le diga lo contrario, y aquí los
    /// marcadores van numerados y en orden, así que daría igual… hasta que un
    /// `MERGE` repite el mismo valor en dos sitios. Decirlo una vez aquí evita
    /// tener que acordarse en cada instrucción.
    /// </summary>
    protected override void Bind(DbCommand command, string name, PreparedCell cell)
    {
        ArgumentNullException.ThrowIfNull(command);

        ArgumentNullException.ThrowIfNull(cell);

        if (command is OracleCommand oracle)
        {
            oracle.BindByName = true;
        }

        // **En Oracle una cadena vacía es un nulo.** No es una conversión que se
        // decida aquí: es lo que el motor guardaría de todas formas. Mandarla
        // como texto sí cambia las cosas, porque ODP.NET intenta convertirla al
        // tipo de la columna y una cadena vacía no es un número ni una fecha: el
        // driver falla con «Must specify valid information for parsing» antes de
        // llegar al servidor, y ese mensaje no se parece a nada que el usuario
        // pueda arreglar.
        if (cell.Value is string { Length: 0 })
        {
            cell = cell with { Value = DBNull.Value };
        }

        // ODP.NET no conoce `DateOnly` ni `TimeOnly` —son de .NET 6 y su driver
        // viene de mucho antes— y los rechaza con «Value does not fall within the
        // expected range», que no dice ni qué valor ni por qué. Se convierten a
        // los tipos que sí entiende, que además son los que Oracle guarda: su
        // `DATE` siempre lleva hora, y un rato suelto es un intervalo.
        cell = cell.Value switch
        {
            DateOnly date => cell with { Value = date.ToDateTime(TimeOnly.MinValue) },
            TimeOnly time => cell with { Value = time.ToTimeSpan() },
            _ => cell,
        };

        base.Bind(command, name, cell);
    }

    /// <summary>
    /// Aquí tampoco hay cláusula que añadir al `INSERT`: es un `MERGE` entero.
    ///
    /// Oracle no tiene un «inserta y si ya está, actualiza» en una línea. La fila
    /// entra como origen del `MERGE` —`USING (SELECT … FROM DUAL)`, porque un
    /// `VALUES` suelto no es una tabla aquí— y las dos ramas dicen qué hacer en
    /// cada caso.
    ///
    /// La condición contempla los nulos columna a columna: en un `MERGE`,
    /// `NULL = NULL` es desconocido, y una clave con nulos dejaría de encontrar la
    /// fila que sí está.
    ///
    /// **Sin punto y coma final**, al revés que en SQL Server: aquí lo rechaza el
    /// motor. Ver <see cref="OracleStatement"/>.
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

        // El origen se escribe con alias por columna: `SELECT :p0 AS "id" … FROM
        // DUAL`. Es lo que le da nombre a cada valor para poder referirlo después
        // en las dos ramas.
        var source = string.Join(
            ", ",
            batch.Columns.Select((column, index) =>
                $"{(literal ? row[index].Literal : Parameter(index))} AS {Quote(column)}"));

        var on = string.Join(
            " AND ",
            keyColumns.Select(column =>
                $"(t.{Quote(column)} = s.{Quote(column)} " +
                $"OR (t.{Quote(column)} IS NULL AND s.{Quote(column)} IS NULL))"));

        var merge = $"MERGE INTO {target} t USING (SELECT {source} FROM DUAL) s ON ({on})";

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

        return $"{merge} WHEN NOT MATCHED THEN INSERT ({columns}) VALUES ({inserted})";
    }
}
