using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Diagramas guardados.
///
/// Uno a uno y por identificador, como los fragmentos de SQL: quien guarda pone
/// el identificador, así que renombrar un diagrama y crear otro son la misma
/// operación con distinto identificador y no hay que preguntar cuál de las dos
/// es.
///
/// **Aquí no entra ni una columna ni un tipo del catálogo** (ver
/// <see cref="SavedDiagram"/>): lo que se guarda son las decisiones de quien lo
/// armó, y el esquema se relee al abrirlo.
/// </summary>
public interface IDiagramStore
{
    /// <summary>Los diagramas de una conexión, por lo último que se tocó.</summary>
    Task<IReadOnlyList<SavedDiagram>> GetAllAsync(Guid connectionId, CancellationToken cancellationToken);

    Task<SavedDiagram?> FindAsync(Guid id, CancellationToken cancellationToken);

    Task SaveAsync(SavedDiagram diagram, CancellationToken cancellationToken);

    Task DeleteAsync(Guid id, CancellationToken cancellationToken);
}
