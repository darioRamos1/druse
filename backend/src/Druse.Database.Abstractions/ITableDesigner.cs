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
    /// Cómo llama este motor al tipo que guarda esto.
    ///
    /// Es la mitad que le toca a cada dialecto de traducir tipos entre motores: la
    /// otra —clasificar lo que se lee— ya la hace el dominio. Con esto no hace
    /// falta una tabla de todos los motores contra todos, que con cuatro serían
    /// doce direcciones y crecería al cuadrado; hacen falta cuatro respuestas a la
    /// misma pregunta.
    ///
    /// **Devuelve siempre algo.** Un motor sin tipo para una familia contesta con
    /// el más cercano que tenga —un identificador único donde no existe es texto
    /// de 36 caracteres— y quien llama se encarga de decir qué se pierde. Negarse
    /// aquí dejaría a la vista previa sin nada que enseñar.
    /// </summary>
    string TypeFor(TypeFacets facets);

    /// <summary>
    /// Lo que este motor admite al definir un índice.
    ///
    /// La interfaz dibuja el formulario a partir de esto, en lugar de preguntar
    /// por el motor: así `INCLUDE` aparece donde existe y desaparece donde no,
    /// sin que ningún componente sepa contra qué está conectado (plan §14).
    /// </summary>
    IndexCapabilities IndexCapabilities { get; }

    /// <summary>
    /// El DDL de este motor se deshace si algo falla a mitad, o si el usuario
    /// deshace su transacción.
    ///
    /// Lo sabe el proveedor, pero tiene que llegar hasta la interfaz: en MySQL un
    /// `ALTER` queda hecho aunque después se pulse Rollback, y quien no lo sepa
    /// creerá que su tabla volvió a estar como estaba.
    /// </summary>
    bool SupportsTransactionalDdl { get; }

    /// <summary>El `CREATE TABLE` que se ejecutaría, para enseñarlo antes.</summary>
    IReadOnlyList<string> DescribeCreate(TableDefinition table);

    /// <summary>Las instrucciones que se ejecutarían para cambiar la tabla.</summary>
    IReadOnlyList<string> DescribeAlter(TableAlteration alteration);

    /// <summary>
    /// Lo mismo, pero **pudiendo mirar cómo está la tabla hoy**.
    ///
    /// Existe por SQLite. Allí `ALTER TABLE` casi no existe: renombrar, añadir
    /// una columna y quitarla, y nada más. Cambiar el tipo de una columna, tocar
    /// la clave primaria o añadir una restricción se hacen **reconstruyendo la
    /// tabla**: crear una nueva con la forma que se quiere, copiar las filas,
    /// borrar la vieja y renombrar. Y para escribir esa tabla nueva hay que saber
    /// cómo era la anterior, que es justo lo que el cambio no dice: el cambio
    /// dice qué se toca, no lo que se queda.
    ///
    /// Los cinco motores restantes no necesitan mirar nada, y por eso lo de
    /// arriba sigue siendo lo normal: esta versión se limita a llamarlo. Un
    /// proveedor la reescribe solo si de verdad le hace falta.
    /// </summary>
    Task<IReadOnlyList<string>> DescribeAlterAsync(
        IDatabaseSession session,
        TableAlteration alteration,
        CancellationToken cancellationToken) =>
        Task.FromResult(DescribeAlter(alteration));

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
