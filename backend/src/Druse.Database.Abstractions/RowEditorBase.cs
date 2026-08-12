using System.Data.Common;
using System.Diagnostics;
using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>
/// Lo que hacer con los cambios de filas es igual en los tres motores; lo único
/// que cambia es cómo se citan los nombres y cómo se llaman los parámetros.
///
/// Vive aquí y no repetido en cada proveedor porque esto **no es dialecto, son
/// las reglas de seguridad**: transacción, parámetros y una fila por
/// instrucción. Tres copias de esto acabarían separándose, y la copia que se
/// quedara atrás sería la que borra datos de más.
/// </summary>
public abstract class RowEditorBase : IRowEditor
{
    public abstract DatabaseEngine Engine { get; }

    /// <summary>Cómo cita este motor un nombre: `[x]`, `"x"` o `` `x` ``.</summary>
    protected abstract string Quote(string identifier);

    /// <summary>Cómo se nombra el parámetro número <paramref name="index"/>.</summary>
    protected abstract string Parameter(int index);

    /// <summary>La conexión de la sesión, comprobando que es de este proveedor.</summary>
    protected abstract DbConnection Connection(IDatabaseSession session);

    public IReadOnlyList<string> Describe(PreparedRowEditBatch batch)
    {
        ArgumentNullException.ThrowIfNull(batch);

        return [.. batch.Edits.Select(edit => Statement(batch, edit, literal: true))];
    }

    public async Task<RowEditResult> ApplyAsync(
        IDatabaseSession session,
        PreparedRowEditBatch batch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(batch);

        var connection = Connection(session);
        var stopwatch = Stopwatch.StartNew();
        var afectadas = 0L;

        // Todo junto o nada: si el tercero de cinco falla, la tabla no puede
        // quedar a medio ajustar.
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            foreach (var edit in batch.Edits)
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = Statement(batch, edit, literal: false);

                var index = 0;

                foreach (var cell in edit.Changes.Concat(edit.Key))
                {
                    var parameter = command.CreateParameter();
                    parameter.ParameterName = Parameter(index++);
                    parameter.Value = cell.Value;
                    command.Parameters.Add(parameter);
                }

                var filas = await command.ExecuteNonQueryAsync(cancellationToken);

                // La comprobación que evita el accidente serio: si la clave no
                // era única, o la fila ya no está, se deshace todo.
                if (filas != 1)
                {
                    await transaction.RollbackAsync(CancellationToken.None);

                    throw new RowEditFailedException(
                        filas == 0
                            ? "Una de las filas ya no existe o alguien la cambió mientras editabas. No se guardó nada."
                            : $"Una instrucción habría cambiado {filas} filas en lugar de una. No se guardó nada.");
                }

                afectadas += filas;
            }

            await transaction.CommitAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not RowEditFailedException)
        {
            await transaction.RollbackAsync(CancellationToken.None);
            throw;
        }

        stopwatch.Stop();

        return new RowEditResult
        {
            RowsAffected = afectadas,
            Duration = stopwatch.Elapsed,
            Statements = Describe(batch),
        };
    }

    /// <summary>
    /// El `UPDATE` de una fila.
    ///
    /// El mismo método escribe el que se ejecuta y el que se enseña, para que no
    /// puedan decir cosas distintas: solo cambia si los valores van como
    /// parámetros o escritos.
    /// </summary>
    private string Statement(PreparedRowEditBatch batch, PreparedRowEdit edit, bool literal)
    {
        var name = batch.Schema is null
            ? Quote(batch.Table)
            : $"{Quote(batch.Schema)}.{Quote(batch.Table)}";

        var index = 0;

        var sets = edit.Changes.Select(cell =>
            $"{Quote(cell.Column)} = {(literal ? cell.Literal : Parameter(index++))}");

        // Los parámetros de la clave van después de los del SET: es el orden en
        // que se añaden al comando.
        var indexKey = literal ? 0 : edit.Changes.Count;

        var where = edit.Key.Select(cell =>
            $"{Quote(cell.Column)} = {(literal ? cell.Literal : Parameter(indexKey++))}");

        return $"UPDATE {name} SET {string.Join(", ", sets)} WHERE {string.Join(" AND ", where)}";
    }
}

/// <summary>Los cambios no se aplicaron, y la transacción se deshizo.</summary>
public sealed class RowEditFailedException(string message) : InvalidOperationException(message);
