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
}
