using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Host.LocalApi.Endpoints;

internal static class AiBusinessNoteEndpoints
{
    public static void MapAiBusinessNoteEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/ai/notes", async (IAiBusinessNoteStore notes, CancellationToken cancellationToken) =>
            Results.Ok(await notes.GetAllAsync(cancellationToken)));

        app.MapPut("/api/ai/notes/{id:guid}", async (Guid id, AiBusinessNote request,
            IAiBusinessNoteStore notes, IConnectionProfileStore connections, CancellationToken cancellationToken) =>
        {
            var previous = (await notes.GetAllAsync(cancellationToken)).FirstOrDefault(note => note.Id == id);
            if (previous is { FormatVersion: not 1 } || request.FormatVersion != 1)
            {
                return Results.Conflict(new { message = "Esta versión de Druse no puede editar ese formato de nota." });
            }
            if (request.ConnectionId == Guid.Empty || string.IsNullOrWhiteSpace(request.Database)
                || string.IsNullOrWhiteSpace(request.Text) || request.Text.Length > 8000
                || (request.Reference is { } reference && (string.IsNullOrWhiteSpace(reference.ObjectId)
                    || reference.Schema is null
                    || string.IsNullOrWhiteSpace(reference.Table) || reference.Kind is not ("table" or "view")
                    || reference.Column is not null && string.IsNullOrWhiteSpace(reference.Column))))
            {
                return Results.BadRequest(new { message = "La nota necesita una base, una referencia válida y entre 1 y 8000 caracteres." });
            }
            // Borrar una conexión conserva las notas: se pueden editar o vincular expresamente a otra.
            if (await connections.FindAsync(request.ConnectionId, cancellationToken) is null
                && !(previous?.ConnectionId == request.ConnectionId && previous.Database == request.Database
                    && previous.Reference == request.Reference))
            {
                return Results.BadRequest(new { message = "Guarda la conexión antes de crear notas para ella." });
            }
            var saved = request with { Id = id, Text = request.Text.Trim(), UpdatedAtUtc = DateTimeOffset.UtcNow };
            await notes.SaveAsync(saved, cancellationToken);
            return Results.Ok(saved);
        });

        app.MapDelete("/api/ai/notes/{id:guid}", async (Guid id, IAiBusinessNoteStore notes, CancellationToken cancellationToken) =>
            await notes.DeleteAsync(id, cancellationToken) ? Results.NoContent() : Results.NotFound());
    }
}
