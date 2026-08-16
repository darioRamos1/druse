using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>Una columna con su valor ya convertido, lista para ir como parámetro.</summary>
/// <param name="Column">Nombre sin comillas: cada proveedor lo cita a su manera.</param>
/// <param name="Value">Valor convertido, o <see cref="DBNull"/>.</param>
/// <param name="Literal">El mismo valor escrito para leerlo, nunca para ejecutarlo.</param>
public sealed record PreparedCell(string Column, object Value, string Literal);

/// <summary>Un `UPDATE` de una fila, ya validado y con los valores convertidos.</summary>
public sealed record PreparedRowEdit
{
    public required IReadOnlyList<PreparedCell> Key { get; init; }

    public required IReadOnlyList<PreparedCell> Changes { get; init; }
}

/// <summary>
/// Filas que se van a borrar, cada una identificada por su clave.
///
/// Solo lleva claves: un borrado no necesita valores, y no tenerlos evita la
/// duda de si el resto de la fila influye en algo.
/// </summary>
public sealed record PreparedRowDeleteBatch
{
    /// <summary>Esquema de la tabla. Puede faltar en motores que no lo usan.</summary>
    public string? Schema { get; init; }

    public required string Table { get; init; }

    public required IReadOnlyList<IReadOnlyList<PreparedCell>> Keys { get; init; }
}

/// <summary>Lo que hay que aplicar, sin nada por decidir.</summary>
public sealed record PreparedRowEditBatch
{
    /// <summary>Esquema de la tabla. Puede faltar en motores que no lo usan.</summary>
    public string? Schema { get; init; }

    public required string Table { get; init; }

    public required IReadOnlyList<PreparedRowEdit> Edits { get; init; }
}

/// <summary>
/// Escribe cambios de filas en el motor.
///
/// Existe aparte de <see cref="IQueryExecutor"/> porque no ejecuta SQL del
/// usuario, sino SQL que Druse escribe. Eso cambia las reglas: aquí los
/// identificadores se citan según el dialecto, los valores viajan siempre como
/// parámetros y **cada instrucción tiene que afectar exactamente a una fila**.
///
/// La comprobación del número de filas no es un detalle: es lo que impide que un
/// `UPDATE` pensado para una fila modifique media tabla porque la clave no era
/// única. Si alguna afecta a otra cantidad, se deshace todo.
/// </summary>
public interface IRowEditor
{
    DatabaseEngine Engine { get; }

    /// <summary>
    /// El SQL que se ejecutaría, con los valores escritos, para enseñarlo antes.
    ///
    /// Lo que se ejecuta usa parámetros; esto es la misma instrucción hecha
    /// legible. Nunca debe mandarse al servidor.
    /// </summary>
    IReadOnlyList<string> Describe(PreparedRowEditBatch batch);

    /// <summary>Aplica todos los cambios en una transacción.</summary>
    Task<RowEditResult> ApplyAsync(
        IDatabaseSession session,
        PreparedRowEditBatch batch,
        CancellationToken cancellationToken);

    /// <summary>El `INSERT` que se ejecutaría, con los valores escritos.</summary>
    IReadOnlyList<string> DescribeInsert(PreparedInsertBatch batch);

    /// <summary>
    /// Inserta filas en una tabla, todas en una transacción.
    ///
    /// Es el mismo camino que la edición y por los mismos motivos: parámetros,
    /// identificadores citados por el dialecto y todo o nada. Importar medio
    /// archivo es peor que no importarlo, porque nadie sabe por dónde se quedó.
    /// </summary>
    Task<RowEditResult> InsertAsync(
        IDatabaseSession session,
        PreparedInsertBatch batch,
        CancellationToken cancellationToken);

    /// <summary>El `DELETE` que se ejecutaría, con los valores escritos.</summary>
    IReadOnlyList<string> DescribeDelete(PreparedRowDeleteBatch batch);

    /// <summary>
    /// Borra filas señaladas por su clave, todas en una transacción.
    ///
    /// Rige la misma regla que la edición y aquí importa aún más: **cada
    /// instrucción tiene que borrar exactamente una fila**. Si una clave
    /// resultara no ser única, un borrado pensado para una fila se llevaría
    /// varias, y eso no se deshace mirando la pantalla.
    /// </summary>
    Task<RowEditResult> DeleteAsync(
        IDatabaseSession session,
        PreparedRowDeleteBatch batch,
        CancellationToken cancellationToken);
}

/// <summary>Filas a insertar, ya validadas y con los valores convertidos.</summary>
public sealed record PreparedInsertBatch
{
    public string? Schema { get; init; }

    public required string Table { get; init; }

    /// <summary>Columnas de destino, en el orden en que van los valores.</summary>
    public required IReadOnlyList<string> Columns { get; init; }

    public required IReadOnlyList<IReadOnlyList<PreparedCell>> Rows { get; init; }
}
