using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>Resultado de aplicar un cambio de estructura.</summary>
/// <param name="Statements">Lo que se ejecutó, escrito para poder leerlo.</param>
/// <param name="Duration">Lo que tardó el motor.</param>
public readonly record struct TableChangeResult(
    IReadOnlyList<string> Statements,
    TimeSpan Duration);

/// <summary>
/// Escribe y ejecuta el DDL de un motor.
///
/// El SQL lo genera siempre el proveedor a partir del diseño, nunca el cliente:
/// aceptar instrucciones ya escritas convertiría este camino en una vía para
/// ejecutar cualquier cosa saltándose el análisis de riesgo (plan §12).
/// </summary>
public interface ITableDesigner
{
    DatabaseEngine Engine { get; }

    /// <summary>Tipos que se ofrecen en el formulario. No son todos los del motor.</summary>
    IReadOnlyList<string> CommonDataTypes { get; }

    /// <summary>
    /// Lo que este motor admite al definir un índice.
    ///
    /// La interfaz dibuja el formulario a partir de esto, en lugar de preguntar
    /// por el motor: así `INCLUDE` aparece donde existe y desaparece donde no,
    /// sin que ningún componente sepa contra qué está conectado (plan §14).
    /// </summary>
    IndexCapabilities IndexCapabilities { get; }

    /// <summary>El `CREATE TABLE` que se ejecutaría, para enseñarlo antes.</summary>
    IReadOnlyList<string> DescribeCreate(TableDefinition table);

    /// <summary>Las instrucciones que se ejecutarían para cambiar la tabla.</summary>
    IReadOnlyList<string> DescribeAlter(TableAlteration alteration);

    /// <summary>
    /// Crea la tabla.
    ///
    /// Devuelve lo mismo que <see cref="DescribeCreate"/> ejecutado: quien mira el
    /// resultado ve exactamente lo que corrió, no una reconstrucción.
    /// </summary>
    Task<TableChangeResult> CreateAsync(
        IDatabaseSession session,
        TableDefinition table,
        CancellationToken cancellationToken);

    /// <summary>
    /// Aplica los cambios.
    ///
    /// Cada instrucción va por su cuenta salvo que el motor admita DDL
    /// transaccional; el proveedor decide, porque es quien sabe si su motor
    /// deshace un `ALTER TABLE` a medias.
    /// </summary>
    Task<TableChangeResult> AlterAsync(
        IDatabaseSession session,
        TableAlteration alteration,
        CancellationToken cancellationToken);
}
