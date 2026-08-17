using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Application.Backups;

/// <summary>El guion que se escribiría, con lo que hay que saber antes de lanzarlo.</summary>
public sealed record BackupPreview
{
    public required IReadOnlyList<string> Statements { get; init; }

    /// <summary>Se alcanzó el tope y hay más instrucciones que no se enseñan.</summary>
    public bool Truncated { get; init; }

    /// <summary>Lo que ya se sabe que va a salir mal, antes de escribir nada.</summary>
    public IReadOnlyList<BackupWarning> Warnings { get; init; } = [];
}

/// <summary>
/// Recoge el guion en memoria en vez de escribirlo, para enseñarlo.
///
/// Corta al llegar al tope y lo dice: una vista previa no es un respaldo, y
/// acumular millones de instrucciones para pintarlas en una pantalla sería la
/// forma más segura de agotar la memoria del proceso justo cuando el usuario
/// todavía no ha decidido nada.
/// </summary>
internal sealed class PreviewSink(int maxStatements) : IBackupSink
{
    private readonly List<string> _statements = [];

    public IReadOnlyList<string> Statements => _statements;

    public bool Truncated { get; private set; }

    public Task WriteAsync(
        BackupEntryKind kind,
        string objectName,
        string text,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return Task.CompletedTask;
        }

        if (_statements.Count >= maxStatements)
        {
            Truncated = true;
            return Task.CompletedTask;
        }

        _statements.Add(text);

        return Task.CompletedTask;
    }

    /// <summary>
    /// En una vista previa no hay CSV: lo que se enseña es el guion, y un archivo
    /// de datos aparte no se lee en pantalla.
    /// </summary>
    public Task WriteDataStreamAsync(
        string objectName,
        string extension,
        Func<Stream, CancellationToken, Task> write,
        CancellationToken cancellationToken) =>
        Task.CompletedTask;

    /// <summary>No hay artefacto que cerrar: nada de esto tocó el disco.</summary>
    public Task<BackupArtifact> CompleteAsync(
        BackupManifest manifest,
        CancellationToken cancellationToken) =>
        Task.FromResult(new BackupArtifact(string.Empty, 0));

    public Task DiscardAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public ValueTask DisposeAsync() => ValueTask.CompletedTask;
}
