using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>
/// Lo que el DDL tiene en común entre motores.
///
/// La forma de un `CREATE TABLE` es la misma en los tres: nombre calificado,
/// columnas entre paréntesis y una clave primaria al final. Lo que cambia es
/// cómo se citan los identificadores, cómo se declara una columna que genera su
/// valor y cómo se escribe cada `ALTER`. Esas diferencias, y solo esas, quedan
/// en manos de cada proveedor.
/// </summary>
public abstract class TableDesignerBase : ITableDesigner
{
    public abstract DatabaseEngine Engine { get; }

    public abstract IReadOnlyList<string> CommonDataTypes { get; }

    /// <summary>Cita un identificador en el dialecto del motor.</summary>
    protected abstract string Quote(string identifier);

    protected abstract DbConnection Connection(IDatabaseSession session);

    /// <summary>
    /// Cómo se declara que el motor genera el valor de la columna.
    ///
    /// Va justo detrás del tipo. Cada motor lo llama de una forma —identidad,
    /// serial, autoincremento— y alguno lo escribe en otro sitio de la línea.
    /// </summary>
    protected abstract string IdentityClause(TableColumnDefinition column);

    /// <summary>Las instrucciones que cambian una columna existente.</summary>
    protected abstract IReadOnlyList<string> AlterColumn(
        string qualifiedTable,
        ColumnAlteration change);

    /// <summary>Cómo se renombra una tabla.</summary>
    protected abstract string RenameTable(string qualifiedTable, DatabaseObject table, string newName);

    /// <summary>
    /// El DDL de este motor se deshace solo si algo falla a mitad.
    ///
    /// PostgreSQL y SQL Server admiten `ALTER TABLE` dentro de una transacción;
    /// MySQL hace un commit implícito antes de cada uno, así que allí prometer
    /// atomicidad sería mentir.
    /// </summary>
    protected virtual bool SupportsTransactionalDdl => true;

    public IReadOnlyList<string> DescribeCreate(TableDefinition table)
    {
        ArgumentNullException.ThrowIfNull(table);

        var lines = table.Columns.Select(ColumnDefinition).ToList();
        var key = table.PrimaryKeyColumns;

        if (key.Count > 0)
        {
            lines.Add($"  PRIMARY KEY ({string.Join(", ", key.Select(Quote))})");
        }

        return
        [
            $"CREATE TABLE {Qualify(table.Database, table.Schema, table.Name)} (" +
            Environment.NewLine +
            string.Join("," + Environment.NewLine, lines) +
            Environment.NewLine +
            ");",
        ];
    }

    public IReadOnlyList<string> DescribeAlter(TableAlteration alteration)
    {
        ArgumentNullException.ThrowIfNull(alteration);

        var table = Qualify(
            alteration.Table.Database,
            alteration.Table.Schema,
            alteration.Table.Name);

        var statements = new List<string>();

        // El orden importa: primero se añade y se cambia, y solo al final se borra
        // y se renombra la tabla. Renombrarla antes dejaría al resto de
        // instrucciones apuntando a un nombre que ya no existe.
        foreach (var column in alteration.AddedColumns)
        {
            statements.Add($"ALTER TABLE {table} ADD {ColumnDefinition(column).TrimStart()};");
        }

        foreach (var change in alteration.AlteredColumns)
        {
            statements.AddRange(AlterColumn(table, change));
        }

        foreach (var dropped in alteration.DroppedColumns)
        {
            statements.Add($"ALTER TABLE {table} DROP COLUMN {Quote(dropped)};");
        }

        if (alteration.NewName is not null)
        {
            statements.Add(RenameTable(table, alteration.Table, alteration.NewName));
        }

        return statements;
    }

    public Task<TableChangeResult> CreateAsync(
        IDatabaseSession session,
        TableDefinition table,
        CancellationToken cancellationToken) =>
        ExecuteAsync(session, DescribeCreate(table), cancellationToken);

    public Task<TableChangeResult> AlterAsync(
        IDatabaseSession session,
        TableAlteration alteration,
        CancellationToken cancellationToken) =>
        ExecuteAsync(session, DescribeAlter(alteration), cancellationToken);

    /// <summary>
    /// Ejecuta las instrucciones que este mismo objeto acaba de escribir.
    ///
    /// Nunca recibe SQL de fuera: quien llama entrega el diseño y aquí se
    /// convierte en instrucciones, de modo que no hay forma de colar una tercera
    /// cosa por este camino.
    /// </summary>
    private async Task<TableChangeResult> ExecuteAsync(
        IDatabaseSession session,
        IReadOnlyList<string> statements,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);

        var connection = Connection(session);
        var stopwatch = Stopwatch.StartNew();

        await using var transaction = SupportsTransactionalDdl
            ? await connection.BeginTransactionAsync(cancellationToken)
            : null;

        foreach (var sql in statements)
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Transaction = transaction;

            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        if (transaction is not null)
        {
            await transaction.CommitAsync(cancellationToken);
        }

        stopwatch.Stop();

        return new TableChangeResult(statements, stopwatch.Elapsed);
    }

    /// <summary>Una línea de la definición, ya indentada para el `CREATE TABLE`.</summary>
    protected string ColumnDefinition(TableColumnDefinition column)
    {
        var parts = new List<string> { $"  {Quote(column.Name)}", column.DataType.Trim() };

        if (column.IsIdentity)
        {
            var identity = IdentityClause(column);

            if (identity.Length > 0)
            {
                parts.Add(identity);
            }
        }

        // El valor por omisión va antes de la nulabilidad porque es el orden que
        // aceptan los tres motores; al revés, SQL Server protesta.
        if (!string.IsNullOrWhiteSpace(column.DefaultValue))
        {
            parts.Add($"DEFAULT {column.DefaultValue.Trim()}");
        }

        parts.Add(column.IsNullable ? "NULL" : "NOT NULL");

        return string.Join(" ", parts);
    }

    /// <summary>
    /// Nombre completo de la tabla.
    ///
    /// La base solo se antepone si el motor la admite en el nombre; el esquema,
    /// solo si lo hay. Escribir `.` de más produce un nombre inválido en cuanto
    /// una de las dos partes falta.
    /// </summary>
    protected virtual string Qualify(string? database, string? schema, string name)
    {
        var parts = new List<string>();

        if (!string.IsNullOrWhiteSpace(schema))
        {
            parts.Add(Quote(schema));
        }

        parts.Add(Quote(name));

        return string.Join(".", parts);
    }

    /// <summary>Texto de duración en milisegundos, con cultura invariante.</summary>
    protected static string Milliseconds(TimeSpan duration) =>
        ((long)duration.TotalMilliseconds).ToString(CultureInfo.InvariantCulture);
}
