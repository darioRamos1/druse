namespace Druse.Domain;

/// <summary>Valor de una celda tal y como viaja: texto, o nulo de verdad.</summary>
/// <param name="Column">Nombre de la columna, sin comillas ni corchetes.</param>
/// <param name="Value">
/// Texto del valor nuevo, en el mismo formato en que se muestra. `null` es NULL,
/// que no es lo mismo que la cadena vacía.
/// </param>
public sealed record CellValue(string Column, string? Value);

/// <summary>
/// Un cambio sobre una fila concreta.
///
/// La fila se identifica **solo por su clave primaria**. No por su posición en la
/// cuadrícula, que depende del orden de la consulta y podría apuntar a otra fila
/// en cuanto alguien inserte algo.
/// </summary>
public sealed record RowEdit
{
    /// <summary>Columnas de la clave primaria con el valor que tenían al leerlas.</summary>
    public required IReadOnlyList<CellValue> Key { get; init; }

    /// <summary>Columnas que el usuario cambió, con su valor nuevo.</summary>
    public required IReadOnlyList<CellValue> Changes { get; init; }
}

/// <summary>
/// Conjunto de cambios que se aplican juntos.
///
/// Van en una sola transacción a propósito: si el tercero de cinco falla, no
/// puede quedar la tabla a medio ajustar.
/// </summary>
public sealed record RowEditBatch
{
    public required Guid SessionId { get; init; }

    /// <summary>Tabla sobre la que se edita, tal y como la nombra el catálogo.</summary>
    public required DatabaseObject Table { get; init; }

    public required IReadOnlyList<RowEdit> Edits { get; init; }

    /// <summary>El usuario ya vio el SQL y lo confirmó.</summary>
    public bool Confirmed { get; init; }
}

/// <summary>Resultado de aplicar los cambios.</summary>
public sealed record RowEditResult
{
    /// <summary>Filas realmente modificadas por el servidor.</summary>
    public required long RowsAffected { get; init; }

    public required TimeSpan Duration { get; init; }

    /// <summary>SQL que se ejecutó, con los valores puestos, para poder leerlo.</summary>
    public required IReadOnlyList<string> Statements { get; init; }
}

/// <summary>Por qué no se puede editar aquí.</summary>
public enum RowEditRefusal
{
    /// <summary>La conexión está marcada como solo lectura.</summary>
    ReadOnlyConnection = 0,

    /// <summary>La tabla no tiene clave primaria: no hay forma de señalar una fila.</summary>
    NoPrimaryKey = 1,

    /// <summary>La clave enviada no coincide con la clave primaria real.</summary>
    KeyMismatch = 2,

    /// <summary>Se pidió cambiar una columna que la tabla no tiene.</summary>
    UnknownColumn = 3,

    /// <summary>No se envió ningún cambio.</summary>
    NothingToDo = 4,

    /// <summary>El usuario todavía no ha confirmado el SQL.</summary>
    Unconfirmed = 5,

    /// <summary>
    /// Una instrucción tocó un número de filas distinto de una.
    ///
    /// Es la comprobación que impide el peor accidente posible: que un `UPDATE`
    /// pensado para una fila modifique media tabla porque la clave no era única
    /// o alguien la cambió mientras tanto.
    /// </summary>
    UnexpectedRowCount = 6,
}

/// <summary>Rechazo con su motivo y su explicación.</summary>
public sealed record RowEditRejection(RowEditRefusal Reason, string Message);

/// <summary>
/// Filas que se quieren borrar, señaladas por su clave primaria.
///
/// No lleva valores: para borrar basta con saber cuál es la fila, y pedir el
/// resto invitaría a pensar que algo más influye en lo que se va.
/// </summary>
public sealed record RowDeleteBatch
{
    public required Guid SessionId { get; init; }

    /// <summary>Tabla de la que se borra, tal y como la nombra el catálogo.</summary>
    public required DatabaseObject Table { get; init; }

    /// <summary>Una lista de claves: cada una identifica una fila.</summary>
    public required IReadOnlyList<IReadOnlyList<CellValue>> Keys { get; init; }

    /// <summary>El usuario ya vio el SQL y lo confirmó.</summary>
    public bool Confirmed { get; init; }
}
