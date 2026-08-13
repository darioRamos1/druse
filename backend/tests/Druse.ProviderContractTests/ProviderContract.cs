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

    ConnectionProfile Profile(bool onlyRead = false);

    DatabaseCredentials Credentials { get; }

    /// <summary>Nombre de la base de pruebas.</summary>
    string DatabaseName { get; }

    /// <summary>Esquema por omisión: `public` en PostgreSQL, `dbo` en SQL Server.</summary>
    string DefaultSchema { get; }

    // --- SQL que cambia entre motores ---------------------------------------

    /// <summary>Consulta que duerme los segundos indicados.</summary>
    string Sleep(int seconds);

    /// <summary>Genera <paramref name="count"/> filas con una columna `n`.</summary>
    string GenerateRows(int count);

    /// <summary>Emite un mensaje informativo desde el servidor.</summary>
    string RaiseNotice(string text);

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
