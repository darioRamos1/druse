using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.ProviderContractTests;

/// <summary>
/// Lo que cada proveedor debe aportar para poder ejecutar el contrato común.
///
/// **Todo lo que aparece aquí es una dependencia del dialecto declarada de forma
/// explícita.** Si esta interfaz crece mucho, es señal de que las abstracciones
/// están dejando pasar diferencias entre motores que deberían haber absorbido.
/// </summary>
public interface IProviderFixture
{
    string EngineName { get; }

    bool IsAvailable { get; }

    /// <summary>
    /// Por qué no se pudo conectar, cuando <see cref="IsAvailable"/> es falso.
    ///
    /// Sin esto, un motor caído se manifiesta como una suite en verde que no
    /// comprobó nada, y descubrir el motivo obliga a depurar a ciegas.
    /// </summary>
    string? UnavailableReason { get; }

    IDatabaseProvider Provider { get; }

    IQueryExecutor Executor { get; }

    IDatabaseMetadataReader Metadata { get; }

    /// <summary>Quien escribe los cambios hechos sobre la cuadrícula.</summary>
    IRowEditor RowEditor { get; }

    /// <summary>Quien escribe el DDL: crear tablas, índices y restricciones.</summary>
    ITableDesigner Designer { get; }

    /// <summary>
    /// Quien escribe el DDL que reproduce una tabla ya existente.
    ///
    /// En los cuatro proveedores es **el mismo objeto** que <see cref="Designer"/>:
    /// escribir un `CREATE TABLE` desde un diseño y escribirlo desde el catálogo
    /// son la misma tarea con distinta entrada.
    /// </summary>
    IDatabaseScripter Scripter { get; }

    /// <summary>
    /// Cómo llama este motor al tipo de cada familia de datos.
    ///
    /// Es lo que permite que la prueba de respaldo recorra «una columna de cada
    /// tipo» sin escribir cuatro tablas distintas: la prueba pide familias y el
    /// motor pone sus nombres.
    ///
    /// **Una familia ausente es una declaración**, no un olvido: Informix no sabe
    /// escribir un valor binario dentro de una instrucción, así que allí una
    /// columna binaria no se puede respaldar como texto y no aparece.
    /// </summary>
    IReadOnlyDictionary<ColumnFamily, string> TypesByFamily { get; }

    ConnectionProfile Profile(bool onlyRead = false);

    DatabaseCredentials Credentials { get; }

    /// <summary>Nombre de la base de pruebas.</summary>
    string DatabaseName { get; }

    /// <summary>Segunda base autorizada para comprobar la navegación multibase.</summary>
    string SecondaryDatabaseName { get; }

    /// <summary>Esquema por omisión: `public` en PostgreSQL, `dbo` en SQL Server.</summary>
    string DefaultSchema { get; }

    string DefaultSchemaFor(string database);

    ConnectionProfile ProfileForDatabase(string database, bool onlyRead = false);

    // --- SQL que cambia entre motores ---------------------------------------

    /// <summary>Consulta que duerme los segundos indicados.</summary>
    string Sleep(int seconds);

    /// <summary>Genera <paramref name="count"/> filas con una columna `n`.</summary>
    string GenerateRows(int count);

    /// <summary>Emite un mensaje informativo desde el servidor.</summary>
    string RaiseNotice(string text);

    /// <summary>
    /// Si el motor sabe devolver mensajes informativos al cliente.
    ///
    /// Informix no tiene nada equivalente a `RAISE NOTICE`, `PRINT` o `SIGNAL`
    /// fuera de un procedimiento: no es que Druse no los recoja, es que el motor
    /// no los produce. Declararlo aquí deja el hueco a la vista en vez de fingir
    /// que la función existe con una consulta que no avisa de nada.
    /// </summary>
    bool EmitsServerNotices => true;

    /// <summary>
    /// Si un booleano llega al cliente **como** booleano.
    ///
    /// Informix tiene tipo `BOOLEAN`, pero Druse habla con él por DRDA y ese
    /// transporte lo entrega como `SMALLINT` de valor 1 o 0, sin nada que lo
    /// distinga de un entero pequeño cualquiera. Normalizarlo a `true` exigiría
    /// convertir **todos** los `SMALLINT`, y entonces una columna de cantidades
    /// se leería como booleana. Se prefiere enseñar el 1 que el motor manda.
    /// </summary>
    bool TransportsBooleans => true;

    /// <summary>Consulta con un valor de cada tipo básico, en este orden:
    /// entero, decimal 3.5, booleano verdadero, fecha 2026-08-11.</summary>
    string SelectBasicTypes { get; }

    /// <summary>Consulta que devuelve un nulo y una cadena vacía, en ese orden.</summary>
    string SelectNullAndEmpty { get; }

    /// <summary>Consulta sintácticamente inválida.</summary>
    string InvalidSyntax { get; }

    /// <summary>Código que el motor devuelve ante un error de sintaxis.</summary>
    string SyntaxErrorCode { get; }

    /// <summary>Código que el motor devuelve al referenciar una tabla inexistente.</summary>
    string MissingTableCode { get; }

    /// <summary>Lote con tres conjuntos de resultados: columnas `a`, `b` y `c`.</summary>
    string ThreeResultSets { get; }

    /// <summary>Crea una tabla temporal con una columna entera.</summary>
    string CreateTable(string name);

    /// <summary>Elimina la tabla si existe.</summary>
    string DropTable(string name);

    /// <summary>Inserta tres filas en la tabla indicada.</summary>
    string InsertThreeRows(string name);

    /// <summary>Crea una tabla con clave primaria, columna obligatoria, opcional y con valor por defecto.</summary>
    string CreateTableWithColumns(string name);

    /// <summary>
    /// Crea un procedimiento con dos parámetros: `entrada`, que entra, y
    /// `salida`, que sale. Los nombres importan poco —SQL Server los adorna con
    /// `@`— pero el orden y la dirección sí.
    /// </summary>
    string CreateProcedureWithParameters(string name);

    /// <summary>Crea una vista que devuelve una columna llamada `valor`.</summary>
    string CreateView(string name);

    /// <summary>Elimina la vista si existe.</summary>
    string DropView(string name);

    /// <summary>Crea un procedimiento cuyo cuerpo contiene `marca_procedimiento`.</summary>
    string CreateProcedure(string name);

    /// <summary>Elimina el procedimiento si existe.</summary>
    string DropProcedure(string name);

    /// <summary>
    /// Inserta tres filas con nombre en la tabla de <see cref="CreateTableWithColumns"/>,
    /// con los identificadores 1, 2 y 3 y los nombres Ana, Bea y Cris.
    ///
    /// Los identificadores son explícitos porque la edición de filas apunta a una
    /// fila **por su clave**, y una prueba que no sepa cuál es esa clave no
    /// comprueba nada.
    /// </summary>
    string InsertNamedRows(string name);

    /// <summary>Tipo con el que el motor reporta una marca de tiempo con zona horaria.</summary>
    string TimestampTypeName { get; }
}
