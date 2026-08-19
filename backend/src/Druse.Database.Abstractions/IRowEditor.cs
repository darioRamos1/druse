using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>Una columna con su valor ya convertido, lista para ir como parámetro.</summary>
/// <param name="Column">Nombre sin comillas: cada proveedor lo cita a su manera.</param>
/// <param name="Value">Valor convertido, o <see cref="DBNull"/>.</param>
/// <param name="Literal">El mismo valor escrito para leerlo, nunca para ejecutarlo.</param>
/// <param name="DataType">
/// Tipo de la columna tal y como lo nombra el motor.
///
/// Hace falta **para los nulos**: un `DBNull` sin tipo lo manda el driver como
/// texto, y SQL Server rechaza el `INSERT` entero porque no convierte texto a
/// `varbinary`. Con valor no nulo el tipo se infiere solo y esto no se mira.
/// </param>
public sealed record PreparedCell(string Column, object Value, string Literal, string? DataType = null);

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

    /// <summary>
    /// La instrucción que se ejecutaría con este modo, con los valores escritos.
    ///
    /// Existe porque enseñar un `INSERT` pelado cuando lo que se va a ejecutar es
    /// un `MERGE` sería enseñar otra cosa, y la vista previa del traslado está
    /// justo para que lo que se lee sea lo que pasa.
    /// </summary>
    IReadOnlyList<string> DescribeWrite(
        PreparedInsertBatch batch,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns);

    /// <summary>
    /// Inserta filas decidiendo qué pasa con las que ya están en la tabla.
    ///
    /// Es <see cref="InsertAsync"/> con una pregunta más, y existe por el
    /// traslado de datos entre tablas: repetir una copia es lo normal —se cortó,
    /// se añadieron filas al origen, se sincroniza a diario— y sin esto la única
    /// salida es fallar en la primera clave repetida.
    ///
    /// **Las columnas que identifican la fila tienen que estar respaldadas por la
    /// clave primaria o por una restricción de unicidad.** No es una formalidad
    /// del dialecto: sin unicidad, «actualiza la que ya está» puede tocar muchas
    /// filas a la vez, que es exactamente el accidente que el resto de este puerto
    /// existe para impedir. Quien llama lo comprueba antes contra el catálogo.
    ///
    /// El recuento se normaliza: los motores no cuentan igual —MySQL devuelve dos
    /// filas afectadas cuando actualiza una— así que lo que se devuelve es
    /// **cuántas filas se escribieron y cuántas se saltaron**, que significa lo
    /// mismo en los cuatro.
    /// </summary>
    Task<RowEditResult> WriteAsync(
        IDatabaseSession session,
        PreparedInsertBatch batch,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns,
        CancellationToken cancellationToken);

    /// <summary>
    /// Mete varias escrituras seguidas en una sola transacción.
    ///
    /// Existe por el traslado de datos entre tablas, que escribe el destino por
    /// lotes: sin esto, cada lote confirma por su cuenta —que es lo que se quiere
    /// con una tabla de millones de filas, porque una transacción de ese tamaño
    /// revienta el registro del servidor— y con esto se puede pedir lo contrario
    /// para una tabla pequeña, donde dejar la mitad copiada sería peor.
    ///
    /// **Si el usuario ya tiene una transacción manual abierta, no abre ninguna**:
    /// se une a la suya y confirmarla sigue siendo cosa suya. Es la misma regla de
    /// <see cref="OperationScope"/>, y por el mismo motivo: estos motores no
    /// anidan transacciones.
    /// </summary>
    Task<IWriteScope> BeginWriteAsync(
        IDatabaseSession session,
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

/// <summary>
/// Qué hacer con una fila que ya está en la tabla de destino.
///
/// Los tres casos son escrituras distintas, no matices de una: fallar deja la
/// tabla como estaba, actualizar la cambia y saltar no la toca. Por eso se
/// eligen y no se deducen.
/// </summary>
public enum ExistingRowAction
{
    /// <summary>
    /// Chocar y deshacer el lote. Es lo que hace <see cref="IRowEditor.InsertAsync"/>.
    ///
    /// Sigue siendo lo más seguro y por eso es el primero: lo peor que puede
    /// hacer es negarse.
    /// </summary>
    Fail = 0,

    /// <summary>Actualizar la fila que ya estaba con los valores del origen.</summary>
    Update = 1,

    /// <summary>Dejarla como está y seguir, contándola aparte.</summary>
    Skip = 2,
}

/// <summary>
/// Varias escrituras que van juntas o no van.
///
/// Mientras vive, todo lo que escriba esa sesión entra en la misma transacción,
/// incluidas las operaciones que normalmente abrirían la suya. Quien lo abre lo
/// cierra: sin <see cref="CommitAsync"/>, liberarlo deshace lo escrito.
/// </summary>
public interface IWriteScope : IAsyncDisposable
{
    /// <summary>
    /// La transacción es de este alcance y hay algo que confirmar.
    ///
    /// Falso cuando se está dentro de una transacción del usuario: entonces
    /// <see cref="CommitAsync"/> no hace nada, porque confirmarla la decide él.
    /// </summary>
    bool IsOwned { get; }

    Task CommitAsync(CancellationToken cancellationToken);
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
