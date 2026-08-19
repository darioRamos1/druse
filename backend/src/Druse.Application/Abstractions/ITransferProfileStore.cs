using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Migraciones guardadas para repetirlas, junto a las conexiones y a los perfiles
/// de respaldo.
///
/// **Sin credenciales**, igual que aquellos: un perfil describe qué se lleva y a
/// dónde; con qué usuario se entra es asunto de la conexión.
/// </summary>
public interface ITransferProfileStore
{
    /// <summary>Todos, del usado más recientemente al más antiguo.</summary>
    Task<IReadOnlyList<TransferProfile>> GetAllAsync(CancellationToken cancellationToken);

    Task<TransferProfile?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Inserta o reemplaza según el identificador.</summary>
    Task SaveAsync(TransferProfile profile, CancellationToken cancellationToken);

    /// <summary>Devuelve `false` si no existía.</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Anota que se acaba de lanzar.
    ///
    /// Va aparte de <see cref="SaveAsync"/> por lo mismo que en los respaldos:
    /// lanzar un perfil no lo modifica, y guardarlo entero al ejecutarlo daría por
    /// buenos los cambios que el usuario tuviera a medias en la pantalla.
    /// </summary>
    Task<bool> TouchAsync(Guid id, DateTimeOffset runAtUtc, CancellationToken cancellationToken);
}
