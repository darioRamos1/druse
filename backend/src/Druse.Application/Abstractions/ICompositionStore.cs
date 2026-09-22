using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Consultas guardadas desde el compositor.
///
/// Antes vivían en el almacenamiento del navegador: se perdían al limpiar los
/// datos del WebView y no viajaban con el resto del espacio de trabajo. Aquí van
/// con las conexiones y los diagramas.
///
/// Uno a uno y por identificador, como los diagramas: quien guarda pone el
/// identificador, así que renombrar y crear son la misma operación.
/// </summary>
public interface ICompositionStore
{
    /// <summary>Las de una tabla, por lo último que se tocó.</summary>
    Task<IReadOnlyList<SavedComposition>> GetAllAsync(
        Guid connectionId,
        string database,
        string schema,
        string table,
        CancellationToken cancellationToken);

    Task SaveAsync(SavedComposition composition, CancellationToken cancellationToken);

    Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}
