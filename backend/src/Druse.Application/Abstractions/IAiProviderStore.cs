using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Proveedores de IA guardados.
///
/// **La clave no forma parte de este contrato**, igual que la contraseña no
/// forma parte de <see cref="IConnectionProfileStore"/>: `AiProviderProfile` no
/// tiene dónde llevarla, así que ninguna implementación puede persistirla sin
/// cambiar antes el dominio (plan §12).
/// </summary>
public interface IAiProviderStore
{
    Task<IReadOnlyList<AiProviderProfile>> GetAllAsync(CancellationToken cancellationToken);

    Task<AiProviderProfile?> FindAsync(Guid id, CancellationToken cancellationToken);

    /// <summary>Inserta o reemplaza según el identificador.</summary>
    Task SaveAsync(AiProviderProfile profile, CancellationToken cancellationToken);

    /// <summary>Devuelve `false` si no existía.</summary>
    Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken);
}
