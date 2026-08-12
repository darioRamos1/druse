using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Rows;

/// <summary>
/// Aplica cambios hechos sobre la cuadrícula.
///
/// Es la primera vez que Druse escribe en los datos del usuario, así que las
/// reglas son deliberadamente estrictas y todas se comprueban **aquí**, no en la
/// interfaz: una interfaz se puede saltar, un caso de uso no.
///
/// 1. Una conexión de solo lectura no edita nada.
/// 2. Sin clave primaria no se edita: sin ella no hay forma de señalar una fila
///    concreta, y un `UPDATE` sin más podría alcanzar a muchas.
/// 3. La clave que manda el cliente tiene que ser **exactamente** la clave
///    primaria de la tabla, ni más ni menos columnas.
/// 4. No se toca la clave primaria: cambiarla es mover la fila, y eso se hace
///    con SQL a la vista, no arrastrando por una cuadrícula.
/// 5. Sin confirmación no se ejecuta. El usuario tiene que haber visto el SQL.
/// </summary>
public sealed class RowEditService(
    IProviderRegistry providers,
    ConnectionService connections,
    MetadataService metadata)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;
    private readonly MetadataService _metadata = metadata;

    /// <summary>El SQL que se ejecutaría, para enseñarlo antes de tocar nada.</summary>
    public async Task<IReadOnlyList<string>> PreviewAsync(
        RowEditBatch batch,
        CancellationToken cancellationToken)
    {
        var (editor, prepared) = await PrepareAsync(batch, requireConfirmation: false, cancellationToken);

        return editor.Describe(prepared);
    }

    /// <summary>Aplica los cambios, si todas las reglas lo permiten.</summary>
    public async Task<RowEditResult> ApplyAsync(
        RowEditBatch batch,
        CancellationToken cancellationToken)
    {
        var (editor, prepared) = await PrepareAsync(batch, requireConfirmation: true, cancellationToken);

        using var turn = await _connections.EnterAsync(batch.SessionId, cancellationToken);

        var session = _connections.Require(batch.SessionId);

        return await editor.ApplyAsync(session, prepared, cancellationToken);
    }

    private async Task<(IRowEditor Editor, PreparedRowEditBatch Batch)> PrepareAsync(
        RowEditBatch batch,
        bool requireConfirmation,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(batch);

        var session = _connections.Require(batch.SessionId);

        if (session.Profile.ReadOnly)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.ReadOnlyConnection,
                "La conexión está marcada como solo lectura."));
        }

        if (batch.Edits.Count == 0 || batch.Edits.All(edit => edit.Changes.Count == 0))
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.NothingToDo,
                "No hay ningún cambio que guardar."));
        }

        if (requireConfirmation && !batch.Confirmed)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.Unconfirmed,
                "Hay que confirmar los cambios antes de guardarlos."));
        }

        // Las columnas se leen del catálogo y no se aceptan del cliente: es lo
        // que garantiza que la clave sea la de verdad y que los tipos con los que
        // se convierte sean los de la tabla.
        var columns = await _metadata.GetColumnsAsync(batch.SessionId, batch.Table, cancellationToken);
        var byName = columns.ToDictionary(column => column.Name, StringComparer.OrdinalIgnoreCase);
        var primaryKey = columns.Where(column => column.IsPrimaryKey).ToList();

        if (primaryKey.Count == 0)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.NoPrimaryKey,
                $"«{batch.Table.Name}» no tiene clave primaria, así que no hay forma de señalar una fila concreta. " +
                "Edítala con un UPDATE escrito a mano."));
        }

        var edits = new List<PreparedRowEdit>(batch.Edits.Count);

        foreach (var edit in batch.Edits)
        {
            edits.Add(Prepare(edit, byName, primaryKey));
        }

        return (
            _providers.GetRowEditor(session.Engine),
            new PreparedRowEditBatch
            {
                Schema = batch.Table.Schema,
                Table = batch.Table.Name,
                Edits = edits,
            });
    }

    private static PreparedRowEdit Prepare(
        RowEdit edit,
        IReadOnlyDictionary<string, DatabaseColumn> columns,
        IReadOnlyList<DatabaseColumn> primaryKey)
    {
        var enviada = edit.Key.Select(cell => cell.Column).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var real = primaryKey.Select(column => column.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

        if (!enviada.SetEquals(real))
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.KeyMismatch,
                $"Para editar hay que identificar la fila por su clave primaria ({string.Join(", ", real)}). " +
                "Incluye esas columnas en la consulta."));
        }

        foreach (var change in edit.Changes)
        {
            if (real.Contains(change.Column))
            {
                throw new RowEditRejectedException(new RowEditRejection(
                    RowEditRefusal.KeyMismatch,
                    $"«{change.Column}» es clave primaria. Cambiarla es mover la fila, y eso se hace con SQL a la vista."));
            }
        }

        return new PreparedRowEdit
        {
            Key = [.. edit.Key.Select(cell => PrepareCell(cell, columns))],
            Changes = [.. edit.Changes.Select(cell => PrepareCell(cell, columns))],
        };
    }

    private static PreparedCell PrepareCell(
        CellValue cell,
        IReadOnlyDictionary<string, DatabaseColumn> columns)
    {
        if (!columns.TryGetValue(cell.Column, out var column))
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.UnknownColumn,
                $"La tabla no tiene ninguna columna «{cell.Column}»."));
        }

        if (!ColumnValueParser.TryParse(column.DataType, cell.Value, out var value, out var error))
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.UnknownColumn,
                $"{column.Name}: {error}"));
        }

        return new PreparedCell(column.Name, value, ColumnValueParser.ToLiteral(column.DataType, cell.Value));
    }
}

/// <summary>Los cambios no se aplicaron porque una regla lo impidió.</summary>
public sealed class RowEditRejectedException(RowEditRejection rejection)
    : InvalidOperationException(rejection.Message)
{
    public RowEditRejection Rejection { get; } = rejection;
}
