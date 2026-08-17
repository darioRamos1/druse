using System.Data.Common;
using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>
/// Escribe el DDL que reproduce lo que ya existe.
///
/// Es el puerto sobre el que se construyen los respaldos: donde
/// <see cref="ITableDesigner"/> convierte un diseño en instrucciones,
/// esto convierte una **lectura del catálogo** en las instrucciones que la
/// devolverían a la vida.
///
/// Lo escribe siempre el proveedor a partir de lo leído, nunca el cliente: por lo
/// mismo que el diseñador no acepta SQL ya hecho, aceptar aquí instrucciones
/// escritas fuera convertiría el respaldo en una vía para ejecutar cualquier cosa
/// saltándose el análisis de riesgo (plan §12).
///
/// **Los métodos están separados por el orden en que hay que ejecutarlos**, que no
/// es un detalle de presentación:
///
/// 1. <see cref="ScriptTable"/> — la tabla, sin claves foráneas.
/// 2. Los datos, que van entre medias.
/// 3. <see cref="ScriptIndexes"/> — crear los índices antes de cargar haría que
///    cada fila insertada pagase su mantenimiento.
/// 4. <see cref="ScriptForeignKeys"/> — al final **siempre**: entre dos tablas
///    puede haber un ciclo, y con un ciclo no existe ningún orden de creación que
///    las satisfaga a la vez.
/// </summary>
/// <summary>
/// Una instrucción de datos, con cuántas filas lleva dentro.
///
/// El recuento viaja con la instrucción y no se deduce de ella: contar comas en
/// un `INSERT` ya escrito es adivinar, y de ese número sale la barra de progreso
/// que el usuario mira durante veinte minutos.
/// </summary>
/// <param name="Sql">La instrucción, lista para escribir al archivo.</param>
/// <param name="Rows">Filas que inserta.</param>
public readonly record struct ScriptedRows(string Sql, int Rows);

/// <summary>
/// La lectura del respaldo entero, sostenida en el tiempo.
///
/// Existe porque un respaldo no es una consulta: la tabla de pedidos leída a las
/// 10:00 y la de líneas leída a las 10:04 **nacen rotas**, y eso no se ve mirando
/// el archivo. Mientras vive, todas las lecturas ven la base tal como estaba al
/// abrirla.
///
/// No es la transacción del usuario y no debe serlo: aquella la deshace el barrido
/// por inactividad a los quince minutos, que es justo lo que dura un respaldo
/// grande.
/// </summary>
public interface IBackupSnapshot : IAsyncDisposable
{
    /// <summary>La transacción a la que se unen las lecturas, si la hay.</summary>
    DbTransaction? Transaction { get; }

    /// <summary>
    /// El motor concedió de verdad una lectura consistente.
    ///
    /// Falso cuando no se pudo —SQL Server rechaza `SNAPSHOT` si la base no lo
    /// tiene habilitado— y entonces el respaldo **lo dice en su manifiesto** en
    /// lugar de prometer algo que no dio.
    /// </summary>
    bool IsConsistent { get; }
}

public interface IDatabaseScripter
{
    DatabaseEngine Engine { get; }

    /// <summary>Qué conserva este motor de lo que se guioniza.</summary>
    ScripterCapabilities Capabilities { get; }

    /// <summary>
    /// El `CREATE TABLE`: columnas, clave primaria, restricciones de unicidad y de
    /// comprobación. **Sin índices y sin claves foráneas**, que llegan después.
    /// </summary>
    IReadOnlyList<string> ScriptTable(ScriptedTable table);

    /// <summary>
    /// Los índices que no sostiene una restricción.
    ///
    /// Los que sí —el de la clave primaria, el de cada `UNIQUE`— no se escriben:
    /// ya vienen dentro del `CREATE TABLE` con su restricción, y volver a crearlos
    /// sueltos lo rechaza el motor por nombre repetido.
    /// </summary>
    IReadOnlyList<string> ScriptIndexes(ScriptedTable table);

    /// <summary>Las claves foráneas, como `ALTER TABLE` posteriores a los datos.</summary>
    IReadOnlyList<string> ScriptForeignKeys(ScriptedTable table);

    /// <summary>
    /// Los `INSERT` de una tabla, leyendo del motor **según se escriben**.
    ///
    /// Devuelve instrucciones una a una y no una lista porque una tabla de diez
    /// millones de filas no cabe en memoria: quien las consume las va escribiendo
    /// al archivo y no guarda ninguna. Un respaldo que materialice la tabla no
    /// falla en las pruebas, falla en producción.
    ///
    /// El filtro se comprueba antes de armar nada
    /// (<see cref="TableDataFilter.Validate"/>) y se rechaza si no sirve: es la
    /// única entrada de texto libre del respaldo.
    /// </summary>
    IAsyncEnumerable<ScriptedRows> ScriptDataAsync(
        IDatabaseSession session,
        ScriptedTable table,
        TableDataFilter filter,
        IBackupSnapshot? snapshot,
        CancellationToken cancellationToken);

    /// <summary>
    /// Abre la lectura sostenida bajo la que se copia todo.
    ///
    /// Quien la abre la cierra, y hasta entonces pasa el resultado a cada llamada
    /// de <see cref="ScriptDataAsync"/>. Si el motor no puede darla, devuelve una
    /// que lo declara en vez de fallar: un respaldo sin instantánea sigue siendo
    /// mejor que ninguno, siempre que se diga.
    /// </summary>
    Task<IBackupSnapshot> BeginSnapshotAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken);

    /// <summary>
    /// La consulta con la que se leen las filas que se van a copiar.
    ///
    /// Se expone porque los datos no siempre se escriben como `INSERT`: en CSV los
    /// escribe el exportador que ya existe, y necesita el mismo `SELECT` —con su
    /// filtro, su tope y sus columnas excluidas— que usaría el guionizado.
    /// Duplicarlo sería tener dos definiciones de «lo que se copia».
    /// </summary>
    string SelectData(ScriptedTable table, TableDataFilter filter);

    /// <summary>
    /// Lo que hay que ejecutar antes de cargar filas en esta tabla, si algo hace
    /// falta.
    ///
    /// Existe por las columnas que el motor genera: copiar los datos significa
    /// copiar también sus claves, y SQL Server no deja escribir en una columna de
    /// identidad sin abrirle paso antes.
    /// </summary>
    IReadOnlyList<string> BeginDataLoad(ScriptedTable table);

    /// <summary>Lo que cierra lo que abrió <see cref="BeginDataLoad"/>.</summary>
    IReadOnlyList<string> EndDataLoad(ScriptedTable table);

    /// <summary>
    /// Un valor leído del motor, escrito como literal de este dialecto.
    ///
    /// Aquí no valen parámetros: lo que se genera es un archivo de texto que se
    /// ejecutará en otra parte, quizá sin Druse delante. Por eso el escapado es
    /// responsabilidad del proveedor y no de quien llama.
    /// </summary>
    string FormatLiteral(object? value, DatabaseColumn column);
}
