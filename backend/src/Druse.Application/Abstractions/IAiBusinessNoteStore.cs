using Druse.Domain;

namespace Druse.Application.Abstractions;

public interface IAiBusinessNoteStore
{
    Task<IReadOnlyList<AiBusinessNote>> GetAllAsync(CancellationToken cancellationToken);
    Task SaveAsync(AiBusinessNote note, CancellationToken cancellationToken);
    Task<bool> DeleteAsync(Guid id, CancellationToken cancellationToken);
}
