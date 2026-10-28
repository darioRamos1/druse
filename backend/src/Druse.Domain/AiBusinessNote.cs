namespace Druse.Domain;

public sealed record AiNoteReference(string ObjectId, string Schema, string Table, string Kind, string? Column = null);

/// <summary>Conocimiento aportado por la persona; nunca sustituye los hechos del catálogo.</summary>
public sealed record AiBusinessNote(
    Guid Id, Guid ConnectionId, string Database, string Text, bool Enabled,
    AiNoteReference? Reference, DateTimeOffset UpdatedAtUtc, int FormatVersion = 1);
