using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Respaldos guardados para repetirlos, junto a las conexiones.
///
/// **Sin credenciales, igual que los perfiles de conexión.** Un perfil de
/// respaldo describe qué llevarse y en qué forma; con qué usuario se entra es
/// asunto de la conexión, y <see cref="BackupProfile"/> no tiene dónde guardarlo.
/// </summary>
public interface IBackupProfileStore
{
    /// <summary>Todos, del usado más recientemente al más antiguo.</summary>
    Task<IReadOnlyList<BackupProfile>> GetAllAsync(CancellationToken cancellationToken);

    Task<BackupProfile?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Inserta o reemplaza según el identificador.</summary>
    Task SaveAsync(BackupProfile profile, CancellationToken cancellationToken);

    /// <summary>Devuelve `false` si no existía.</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>
    /// Anota que se acaba de lanzar.
    ///
    /// Va aparte de <see cref="SaveAsync"/> porque lanzar un perfil no lo
    /// modifica: si guardara el perfil entero, un respaldo lanzado desde una
    /// pantalla con cambios sin confirmar los daría por buenos.
    /// </summary>
    Task<bool> TouchAsync(Guid id, DateTimeOffset runAtUtc, CancellationToken cancellationToken);
}
