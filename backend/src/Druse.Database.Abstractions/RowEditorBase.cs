using System.Data;
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

    /// <summary>
    /// Nombre con el que se registra el parámetro en el comando.
    ///
    /// Suele coincidir con el marcador que va en el SQL, y por eso es lo que se
    /// devuelve por omisión. Los motores de marcadores **posicionales** son la
    /// excepción: allí el SQL lleva `?` y el enlace es por orden, así que todos
    /// los marcadores son iguales y hace falta un nombre distinto para cada uno.
    /// </summary>
    protected virtual string ParameterName(int index) => Parameter(index);

    /// <summary>La conexión de la sesión, comprobando que es de este proveedor.</summary>
    protected abstract DbConnection Connection(IDatabaseSession session);

    /// <summary>
    /// Añade una celda al comando como parámetro.
    ///
    /// Con valor, el driver deduce el tipo de lo que hay dentro y no hay nada que
    /// decidir. **Con un nulo no hay nada de donde deducirlo**: el driver lo manda
    /// como texto, y SQL Server rechaza el `INSERT` entero antes de mirar la fila
    /// porque no convierte texto a `varbinary`. Por eso la celda lleva el tipo de
    /// su columna: para poder decírselo justo en ese caso.
    /// </summary>
    protected virtual void Bind(DbCommand command, string name, PreparedCell cell)
    {
        ArgumentNullException.ThrowIfNull(command);
        ArgumentNullException.ThrowIfNull(cell);

        var parameter = command.CreateParameter();

        parameter.ParameterName = name;
        parameter.Value = cell.Value;

        if (cell.Value is DBNull && cell.DataType is { } dataType && DbTypeOf(dataType) is { } type)
        {
            parameter.DbType = type;
        }

        command.Parameters.Add(parameter);
    }

    /// <summary>
    /// Qué tipo declarar para un nulo, según la familia de la columna.
    ///
    /// Se clasifica por el nombre del tipo, igual que en todo lo demás: no hace
    /// falta acertar con la longitud ni con la precisión, solo con la familia, que
    /// es lo que decide si el motor acepta el parámetro.
    /// </summary>
    private static DbType? DbTypeOf(string dataType) => ColumnValueParser.Classify(dataType) switch
    {
        ColumnFamily.Text => DbType.String,
        ColumnFamily.Integral => DbType.Int64,
        ColumnFamily.Fractional => DbType.Decimal,
        ColumnFamily.Boolean => DbType.Boolean,
        ColumnFamily.Date => DbType.Date,
        ColumnFamily.Time => DbType.Time,
        ColumnFamily.Timestamp => DbType.DateTime,
        ColumnFamily.TimestampWithZone => DbType.DateTimeOffset,
        ColumnFamily.Binary => DbType.Binary,
        ColumnFamily.Uuid => DbType.Guid,
        _ => null,
    };

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
        await using var scope = await OperationScope.BeginAsync(
            connection,
            session.Transaction,
            cancellationToken);
        var transaction = scope.Transaction;

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
                    Bind(command, ParameterName(index++), cell);
                }

                var filas = await command.ExecuteNonQueryAsync(cancellationToken);

                // La comprobación que evita el accidente serio: si la clave no
                // era única, o la fila ya no está, se deshace todo.
                if (filas != 1)
                {
                    await scope.RollbackAsync(CancellationToken.None);

                    var causa = filas == 0
                        ? "Una de las filas ya no existe o alguien la cambió mientras editabas."
                        : $"Una instrucción habría cambiado {filas} filas en lugar de una.";

                    // Qué pasó con lo ya escrito depende de quién es la
                    // transacción. Decir «no se guardó nada» dentro de una
                    // transacción del usuario sería falso: ahí sigue, y solo su
                    // Rollback lo retira.
                    throw new RowEditFailedException(
                        scope.IsOwned
                            ? $"{causa} No se guardó nada."
                            : $"{causa} Los cambios anteriores siguen dentro de tu transacción: " +
                              "deshazla para retirarlos.");
                }

                afectadas += filas;
            }

            await scope.CommitAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not RowEditFailedException)
        {
            await scope.RollbackAsync(CancellationToken.None);
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

    public IReadOnlyList<string> DescribeInsert(PreparedInsertBatch batch) =>
        DescribeWrite(batch, ExistingRowAction.Fail, []);

    public IReadOnlyList<string> DescribeWrite(
        PreparedInsertBatch batch,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns)
    {
        ArgumentNullException.ThrowIfNull(batch);

        return
        [
            .. batch.Rows.Select(row =>
                WriteStatement(batch, row, onExisting, keyColumns, literal: true)),
        ];
    }

    public Task<RowEditResult> InsertAsync(
        IDatabaseSession session,
        PreparedInsertBatch batch,
        CancellationToken cancellationToken) =>
        WriteAsync(session, batch, ExistingRowAction.Fail, [], cancellationToken);

    public async Task<RowEditResult> WriteAsync(
        IDatabaseSession session,
        PreparedInsertBatch batch,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(batch);
        ArgumentNullException.ThrowIfNull(keyColumns);

        if (onExisting != ExistingRowAction.Fail && keyColumns.Count == 0)
        {
            throw new ArgumentException(
                "Para decidir qué hacer con lo que ya está hace falta saber qué " +
                "columnas identifican la fila.",
                nameof(keyColumns));
        }

        var connection = Connection(session);
        var stopwatch = Stopwatch.StartNew();
        var escritas = 0L;
        var saltadas = 0L;

        // Todo o nada, igual que al editar: media importación es peor que
        // ninguna, porque nadie sabe por dónde se quedó.
        await using var scope = await OperationScope.BeginAsync(
            connection,
            session.Transaction,
            cancellationToken);
        var transaction = scope.Transaction;

        try
        {
            foreach (var row in batch.Rows)
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = WriteStatement(batch, row, onExisting, keyColumns, literal: false);

                Bind(command, row, onExisting);

                // El recuento se normaliza aquí y no en cada proveedor: MySQL
                // devuelve dos filas afectadas cuando actualiza una, así que sumar
                // lo que diga el motor daría un número distinto por motor para el
                // mismo trabajo. Lo que se cuenta es **si la fila se escribió**,
                // que significa lo mismo en los cuatro.
                if (await command.ExecuteNonQueryAsync(cancellationToken) > 0)
                {
                    escritas++;
                }
                else
                {
                    saltadas++;
                }
            }

            await scope.CommitAsync(cancellationToken);
        }
        catch
        {
            await scope.RollbackAsync(CancellationToken.None);
            throw;
        }

        stopwatch.Stop();

        return new RowEditResult
        {
            RowsAffected = escritas,
            RowsSkipped = saltadas,
            Duration = stopwatch.Elapsed,
            // Solo las primeras: un archivo de diez mil filas produciría diez mil
            // instrucciones y nadie las va a leer.
            Statements = [.. DescribeInsert(batch).Take(PreviewedStatements)],
        };
    }

    /// <summary>
    /// Enlaza los valores de una fila como parámetros.
    ///
    /// Los motores que resuelven el conflicto con un `MERGE` los necesitan dos
    /// veces —una para buscar la fila y otra para escribirla— y con marcadores
    /// posicionales eso significa mandarlos repetidos.
    /// </summary>
    private void Bind(DbCommand command, IReadOnlyList<PreparedCell> row, ExistingRowAction onExisting)
    {
        var index = 0;

        foreach (var cell in row)
        {
            Bind(command, ParameterName(index++), cell);
        }

        if (onExisting == ExistingRowAction.Fail || !RepeatsParameters)
        {
            return;
        }

        foreach (var cell in row)
        {
            Bind(command, ParameterName(index++), cell);
        }
    }

    /// <summary>
    /// Este dialecto necesita los valores otra vez para resolver el conflicto.
    ///
    /// Falso en los que lo dicen con una cláusula al final del `INSERT`, que
    /// reutiliza los valores que ya van dentro.
    /// </summary>
    protected virtual bool RepeatsParameters => false;

    /// <summary>
    /// La instrucción que escribe una fila teniendo en cuenta lo que ya está.
    ///
    /// Por omisión es el `INSERT` de siempre con lo que cada motor añade al final
    /// (<see cref="ConflictClause"/>). Los que no saben decirlo así —los que
    /// necesitan un `MERGE`— reescriben este método entero.
    /// </summary>
    protected virtual string WriteStatement(
        PreparedInsertBatch batch,
        IReadOnlyList<PreparedCell> row,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns,
        bool literal)
    {
        var insert = InsertStatement(batch, row, literal);

        return onExisting == ExistingRowAction.Fail
            ? insert
            : $"{insert} {ConflictClause(batch, onExisting, keyColumns)}";
    }

    /// <summary>
    /// Lo que este motor añade al `INSERT` para no chocar con lo que ya está.
    ///
    /// Sin implementar por omisión a propósito: un motor que no sepa decirlo debe
    /// fallar al escribir la instrucción y no al ejecutarla, cuando el mensaje ya
    /// sería del servidor y no diría qué se pretendía.
    /// </summary>
    protected virtual string ConflictClause(
        PreparedInsertBatch batch,
        ExistingRowAction onExisting,
        IReadOnlyList<string> keyColumns) =>
        throw new NotSupportedException(
            $"El proveedor {Engine} todavía no sabe insertar teniendo en cuenta lo que ya está.");

    /// <summary>Las columnas que se escriben y no identifican la fila.</summary>
    protected static IReadOnlyList<string> Updatable(
        PreparedInsertBatch batch,
        IReadOnlyList<string> keyColumns) =>
        [
            .. batch.Columns.Where(column =>
                !keyColumns.Contains(column, StringComparer.OrdinalIgnoreCase)),
        ];

    /// <summary>Cuántas instrucciones se devuelven como muestra al importar.</summary>
    private const int PreviewedStatements = 5;

    public async Task<IWriteScope> BeginWriteAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);

        // Dentro de una transacción del usuario no se abre nada: estos motores no
        // anidan, y la suya ya envuelve todo lo que venga. Confirmarla es cosa
        // suya, así que el alcance se limita a no estorbar.
        if (session.Transaction.Current is not null)
        {
            return WriteScope.Joined;
        }

        var connection = Connection(session);
        var transaction = await connection.BeginTransactionAsync(cancellationToken);

        // Se presta a la sesión para que las escrituras que salgan mientras tanto
        // la lleven puesta. Sin esto, `OperationScope` abriría una transacción por
        // lote y MySQL e Informix rechazarían los comandos que fueran sin ella:
        // es la misma lección que dejó la instantánea de los respaldos.
        session.Transaction.Borrow(transaction);

        return new WriteScope(session.Transaction, transaction);
    }

    /// <summary>
    /// La transacción que abarca varios lotes, devuelta a la sesión al soltarla.
    ///
    /// Deshacer al liberar sin confirmar no es una precaución de más: es lo que
    /// hace que una excepción a mitad del traslado deje el destino como estaba en
    /// lugar de con media tabla dentro de una transacción que nadie va a cerrar.
    /// </summary>
    private sealed class WriteScope(SessionTransaction session, DbTransaction? owned) : IWriteScope
    {
        /// <summary>El alcance que no abrió nada porque ya había transacción.</summary>
        public static WriteScope Joined { get; } = new(SessionTransaction.None, owned: null);

        private bool _committed;

        public bool IsOwned => owned is not null;

        public async Task CommitAsync(CancellationToken cancellationToken)
        {
            if (owned is null || _committed)
            {
                return;
            }

            await owned.CommitAsync(cancellationToken);
            _committed = true;
        }

        public async ValueTask DisposeAsync()
        {
            if (owned is null)
            {
                return;
            }

            if (!_committed)
            {
                try
                {
                    await owned.RollbackAsync(CancellationToken.None);
                }
                catch
                {
                    // La conexión ya no está: no hay nada que deshacer, y el
                    // motor la deshizo por su cuenta al caerse.
                }
            }

            session.Return();
            await owned.DisposeAsync();
        }
    }

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
    public IReadOnlyList<string> DescribeDelete(PreparedRowDeleteBatch batch)
    {
        ArgumentNullException.ThrowIfNull(batch);

        return [.. batch.Keys.Select(key => DeleteStatement(batch, key, literal: true))];
    }

    public async Task<RowEditResult> DeleteAsync(
        IDatabaseSession session,
        PreparedRowDeleteBatch batch,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(batch);

        var connection = Connection(session);
        var stopwatch = Stopwatch.StartNew();
        var afectadas = 0L;

        await using var scope = await OperationScope.BeginAsync(
            connection,
            session.Transaction,
            cancellationToken);
        var transaction = scope.Transaction;

        try
        {
            foreach (var key in batch.Keys)
            {
                await using var command = connection.CreateCommand();
                command.Transaction = transaction;
                command.CommandText = DeleteStatement(batch, key, literal: false);

                var index = 0;

                foreach (var cell in key)
                {
                    Bind(command, ParameterName(index++), cell);
                }

                var filas = await command.ExecuteNonQueryAsync(cancellationToken);

                // Aquí la comprobación pesa más que en la edición: un borrado que
                // afecta a varias filas no se arregla volviendo a escribir el
                // valor anterior, porque ya no hay valor anterior que leer.
                if (filas != 1)
                {
                    await scope.RollbackAsync(CancellationToken.None);

                    var causa = filas == 0
                        ? "Una de las filas ya no existe o alguien la borró mientras mirabas."
                        : $"Una instrucción habría borrado {filas} filas en lugar de una.";

                    throw new RowEditFailedException(
                        scope.IsOwned
                            ? $"{causa} No se borró nada."
                            : $"{causa} Lo borrado antes sigue dentro de tu transacción: " +
                              "deshazla para recuperarlo.");
                }

                afectadas += filas;
            }

            await scope.CommitAsync(cancellationToken);
        }
        catch (Exception exception) when (exception is not RowEditFailedException)
        {
            await scope.RollbackAsync(CancellationToken.None);
            throw;
        }

        stopwatch.Stop();

        return new RowEditResult
        {
            RowsAffected = afectadas,
            Duration = stopwatch.Elapsed,
            Statements = DescribeDelete(batch),
        };
    }

    private string DeleteStatement(
        PreparedRowDeleteBatch batch,
        IReadOnlyList<PreparedCell> key,
        bool literal)
    {
        var name = batch.Schema is null
            ? Quote(batch.Table)
            : $"{Quote(batch.Schema)}.{Quote(batch.Table)}";

        var index = 0;

        var where = key.Select(cell =>
            $"{Quote(cell.Column)} = {(literal ? cell.Literal : Parameter(index++))}");

        return $"DELETE FROM {name} WHERE {string.Join(" AND ", where)}";
    }

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
