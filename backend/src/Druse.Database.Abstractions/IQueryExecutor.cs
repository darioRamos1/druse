using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>
/// Ejecución de SQL arbitrario escrito por el usuario.
///
/// Se implementa siempre sobre <c>DbCommand</c> y <c>DbDataReader</c>. No se usa
/// Entity Framework: aquí no hay entidades que mapear, hay texto que el usuario
/// escribió y que debe llegar al motor tal cual (plan §5).
/// </summary>
public interface IQueryExecutor
{
    DatabaseEngine Engine { get; }

    /// <summary>
    /// Ejecuta y devuelve el resultado.
    ///
    /// El <paramref name="cancellationToken"/> debe llegar hasta el driver, para
    /// que cancelar en la interfaz cancele de verdad en el servidor y no se limite
    /// a dejar de escuchar.
    /// </summary>
    Task<QueryResult> ExecuteAsync(
        IDatabaseSession session,
        QueryRequest request,
        CancellationToken cancellationToken);
}
