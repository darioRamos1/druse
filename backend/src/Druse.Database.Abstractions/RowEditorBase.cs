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

    public IReadOnlyList<string> DescribeInsert(PreparedInsertBatch batch)
    {
        ArgumentNullException.ThrowIfNull(batch);

        return [.. batch.Rows.Select(row => InsertStatement(batch, row, literal: true))];
    }

    public async Task<RowEditResult> InsertAsync(
        IDatabaseSession session,
        PreparedInsertBatch batch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(batch);

        var connection = Connection(session);
        var stopwatch = Stopwatch.StartNew();
        var insertadas = 0L;

        // Todo o nada, igual que al editar: media importación es peor que
        // ninguna, porque nadie sabe por dónde se quedó.
        await using var transaction = await connection.BeginTransactionAsync(cancellationToken);

        try
        {
            foreach (var row in batch.Rows)
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = InsertStatement(batch, row, literal: false);

                var index = 0;

                foreach (var cell in row)
                {
                    var parameter = command.CreateParameter();
                    parameter.ParameterName = Parameter(index++);
                    parameter.Value = cell.Value;
                    command.Parameters.Add(parameter);
                }

                insertadas += await command.ExecuteNonQueryAsync(cancellationToken);
            }

            await transaction.CommitAsync(cancellationToken);
        }
        catch
        {
            await transaction.RollbackAsync(CancellationToken.None);
            throw;
        }

        stopwatch.Stop();

        return new RowEditResult
        {
            RowsAffected = insertadas,
            Duration = stopwatch.Elapsed,
            // Solo las primeras: un archivo de diez mil filas produciría diez mil
            // instrucciones y nadie las va a leer.
            Statements = [.. DescribeInsert(batch).Take(PreviewedStatements)],
        };
    }

    /// <summary>Cuántas instrucciones se devuelven como muestra al importar.</summary>
    private const int PreviewedStatements = 5;

    private string InsertStatement(
        PreparedInsertBatch batch,
        IReadOnlyList<PreparedCell> row,
        bool literal)
    {
        var name = batch.Schema is null
            ? Quote(batch.Table)
            : $"{Quote(batch.Schema)}.{Quote(batch.Table)}";

        var columns = string.Join(", ", batch.Columns.Select(Quote));
        var values = string.Join(
            ", ",
            row.Select((cell, index) => literal ? cell.Literal : Parameter(index)));

        return $"INSERT INTO {name} ({columns}) VALUES ({values})";
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
