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

    public abstract IndexCapabilities IndexCapabilities { get; }

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

    /// <summary>
    /// El tipo tal y como se escribe para esta columna.
    ///
    /// Por omisión es el que eligió el usuario, sin tocar. Existe como gancho
    /// porque hay motores donde **generar el valor es el tipo y no una cláusula
    /// añadida**: en Informix una columna autoincremental se declara `SERIAL`, no
    /// `INTEGER` seguido de algo. Ahí no hay nada que añadir detrás del tipo:
    /// hay que sustituirlo.
    /// </summary>
    protected virtual string DataTypeOf(TableColumnDefinition column)
    {
        ArgumentNullException.ThrowIfNull(column);

        return column.DataType.Trim();
    }

    /// <summary>Las instrucciones que cambian una columna existente.</summary>
    protected abstract IReadOnlyList<string> AlterColumn(
        string qualifiedTable,
        ColumnAlteration change);

    /// <summary>Cómo se renombra una tabla.</summary>
    protected abstract string RenameTable(string qualifiedTable, DatabaseObject table, string newName);

    /// <summary>
    /// Cómo se borra un índice.
    ///
    /// Es la instrucción que más difiere de las tres: PostgreSQL borra el índice
    /// como un objeto del esquema y ni menciona la tabla, mientras que SQL Server
    /// y MySQL la exigen. No hay forma de escribir una sola que valga en los tres.
    /// </summary>
    protected abstract string DropIndex(
        string qualifiedTable,
        DatabaseObject table,
        string indexName);

    /// <summary>
    /// Lo que se escribe entre `CREATE INDEX` y el nombre, para índices que no
    /// son simplemente únicos: `FULLTEXT`, `SPATIAL` y demás.
    /// </summary>
    protected virtual string IndexKind(IndexDefinition index) =>
        index.IsUnique ? "UNIQUE " : string.Empty;

    /// <summary>
    /// La estructura del índice, cuando el motor la escribe antes de las columnas.
    /// MySQL la pone al final, así que allí esto queda vacío.
    /// </summary>
    protected virtual string IndexMethodClause(IndexDefinition index) =>
        string.IsNullOrWhiteSpace(index.Method) ? string.Empty : $" USING {index.Method.Trim()}";

    /// <summary>Lo que se añade después de las columnas: `INCLUDE`, `WHERE` y demás.</summary>
    protected virtual string IndexSuffix(IndexDefinition index)
    {
        ArgumentNullException.ThrowIfNull(index);

        var suffix = string.Empty;

        if (index.IncludedColumns.Count > 0 && IndexCapabilities.SupportsIncludedColumns)
        {
            suffix += $" INCLUDE ({string.Join(", ", index.IncludedColumns.Select(Quote))})";
        }

        if (!string.IsNullOrWhiteSpace(index.Filter) && IndexCapabilities.SupportsFilter)
        {
            suffix += $" WHERE {index.Filter.Trim()}";
        }

        return suffix;
    }

    /// <summary>
    /// El `CREATE INDEX` completo.
    ///
    /// El nombre del índice se cita con el esquema en PostgreSQL, donde vive en
    /// el esquema, y suelto en los otros dos, donde pertenece a la tabla.
    /// </summary>
    protected virtual string CreateIndex(
        string qualifiedTable,
        DatabaseObject table,
        IndexDefinition index)
    {
        ArgumentNullException.ThrowIfNull(index);

        var columns = index.Columns.Select(column =>
            IndexCapabilities.SupportsSortDirection
                ? $"{Quote(column.Name)} {(column.Direction == IndexSortDirection.Descending ? "DESC" : "ASC")}"
                : Quote(column.Name));

        return
            $"CREATE {IndexKind(index)}INDEX {Quote(index.Name)} ON {qualifiedTable}" +
            $"{IndexMethodClause(index)} ({string.Join(", ", columns)})" +
            $"{IndexSuffix(index)};";
    }

    /// <summary>Cómo se cita la tabla a la que apunta una clave foránea.</summary>
    protected virtual string QualifyReference(ForeignKeyDefinition key)
    {
        ArgumentNullException.ThrowIfNull(key);

        return Qualify(key.ReferencedDatabase, key.ReferencedSchema, key.ReferencedTable);
    }

    /// <summary>
    /// Cómo se escribe una acción referencial.
    ///
    /// `NO ACTION` se omite en lugar de escribirse: es lo que hacen los tres
    /// motores si no se dice nada, y escribirlo en MySQL con `SET DEFAULT` al
    /// lado produce una tabla que el motor acepta y luego no respeta.
    /// </summary>
    protected static string ReferentialAction(ForeignKeyAction action) => action switch
    {
        ForeignKeyAction.Cascade => "CASCADE",
        ForeignKeyAction.SetNull => "SET NULL",
        ForeignKeyAction.SetDefault => "SET DEFAULT",
        _ => string.Empty,
    };

    /// <summary>El cuerpo de una clave foránea, sin el `ALTER TABLE` de delante.</summary>
    protected string ForeignKeyBody(ForeignKeyDefinition key)
    {
        ArgumentNullException.ThrowIfNull(key);

        var body =
            $"CONSTRAINT {Quote(key.Name)} FOREIGN KEY " +
            $"({string.Join(", ", key.Columns.Select(Quote))}) " +
            $"REFERENCES {QualifyReference(key)} " +
            $"({string.Join(", ", key.ReferencedColumns.Select(Quote))})";

        var onDelete = ReferentialAction(key.OnDelete);
        var onUpdate = ReferentialAction(key.OnUpdate);

        if (onDelete.Length > 0)
        {
            body += $" ON DELETE {onDelete}";
        }

        if (onUpdate.Length > 0)
        {
            body += $" ON UPDATE {onUpdate}";
        }

        return body;
    }

    /// <summary>
    /// Cómo se suelta una restricción con nombre.
    ///
    /// MySQL necesita decir de qué tipo es —`DROP FOREIGN KEY`, `DROP INDEX`—
    /// mientras que los otros dos borran cualquiera con `DROP CONSTRAINT`.
    /// </summary>
    protected virtual string DropConstraint(
        string qualifiedTable,
        string name,
        ConstraintKind kind) =>
        $"ALTER TABLE {qualifiedTable} DROP CONSTRAINT {Quote(name)};";

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

        var qualified = Qualify(table.Database, table.Schema, table.Name);
        var lines = table.Columns.Select(ColumnDefinition).ToList();
        var key = table.PrimaryKeyColumns;

        if (key.Count > 0)
        {
            lines.Add($"  PRIMARY KEY ({string.Join(", ", key.Select(Quote))})");
        }

        // Las restricciones caben dentro del paréntesis y los índices no: es la
        // única diferencia entre unas y otros a la hora de crear la tabla.
        foreach (var unique in table.UniqueConstraints)
        {
            lines.Add(
                $"  CONSTRAINT {Quote(unique.Name)} UNIQUE " +
                $"({string.Join(", ", unique.Columns.Select(Quote))})");
        }

        foreach (var check in table.CheckConstraints.Where(_ => IndexCapabilities.SupportsCheckConstraints))
        {
            lines.Add($"  CONSTRAINT {Quote(check.Name)} CHECK ({check.Expression.Trim()})");
        }

        foreach (var foreignKey in table.ForeignKeys)
        {
            lines.Add($"  {ForeignKeyBody(foreignKey)}");
        }

        var statements = new List<string>
        {
            $"CREATE TABLE {qualified} (" +
            Environment.NewLine +
            string.Join("," + Environment.NewLine, lines) +
            Environment.NewLine +
            ");",
        };

        var created = new DatabaseObject
        {
            Id = qualified,
            Name = table.Name,
            Kind = DatabaseObjectKind.Table,
            Database = table.Database,
            Schema = table.Schema,
        };

        statements.AddRange(
            table.Indexes.Select(index => CreateIndex(qualified, created, index)));

        return statements;
    }

    public IReadOnlyList<string> DescribeAlter(TableAlteration alteration)
    {
        ArgumentNullException.ThrowIfNull(alteration);

        var table = Qualify(
            alteration.Table.Database,
            alteration.Table.Schema,
            alteration.Table.Name);

        var statements = new List<string>();

        // El orden importa y no es el de la pantalla. Lo que depende de otra cosa
        // se suelta antes y se pone después:
        //
        // 1. Se sueltan claves foráneas e índices, que pueden estar apoyados en
        //    columnas o en la clave primaria que viene detrás.
        // 2. Se suelta la clave primaria, ya sin nadie apoyado en ella.
        // 3. Se añaden y cambian columnas, porque lo nuevo puede necesitarlas.
        // 4. Se pone la clave primaria nueva, que exige sus columnas ya creadas.
        // 5. Se crean índices y restricciones sobre el resultado.
        // 6. Se borran columnas y, al final de todo, se renombra la tabla:
        //    renombrarla antes dejaría al resto apuntando a un nombre que ya no
        //    existe.
        foreach (var name in alteration.DroppedForeignKeys)
        {
            statements.Add(DropConstraint(table, name, ConstraintKind.ForeignKey));
        }

        foreach (var name in alteration.DroppedUniqueConstraints)
        {
            statements.Add(DropConstraint(table, name, ConstraintKind.Unique));
        }

        foreach (var name in alteration.DroppedCheckConstraints)
        {
            statements.Add(DropConstraint(table, name, ConstraintKind.Check));
        }

        foreach (var name in alteration.DroppedIndexes)
        {
            statements.Add(DropIndex(table, alteration.Table, name));
        }

        // Cambiar un índice es borrarlo y volver a crearlo: ningún motor sabe
        // cambiarle las columnas a uno que ya existe.
        foreach (var change in alteration.AlteredIndexes)
        {
            statements.Add(DropIndex(table, alteration.Table, change.CurrentName));
        }

        if (alteration.DroppedPrimaryKeyName is not null)
        {
            statements.Add(DropConstraint(
                table,
                alteration.DroppedPrimaryKeyName,
                ConstraintKind.PrimaryKey));
        }

        foreach (var column in alteration.AddedColumns)
        {
            statements.Add($"ALTER TABLE {table} ADD {ColumnDefinition(column).TrimStart()};");
        }

        foreach (var change in alteration.AlteredColumns)
        {
            statements.AddRange(AlterColumn(table, change));
        }

        if (alteration.NewPrimaryKey is { Columns.Count: > 0 } primaryKey)
        {
            var named = primaryKey.Name is null
                ? string.Empty
                : $"CONSTRAINT {Quote(primaryKey.Name)} ";

            statements.Add(
                $"ALTER TABLE {table} ADD {named}PRIMARY KEY " +
                $"({string.Join(", ", primaryKey.Columns.Select(Quote))});");
        }

        foreach (var unique in alteration.AddedUniqueConstraints)
        {
            statements.Add(
                $"ALTER TABLE {table} ADD CONSTRAINT {Quote(unique.Name)} UNIQUE " +
                $"({string.Join(", ", unique.Columns.Select(Quote))});");
        }

        foreach (var check in alteration.AddedCheckConstraints)
        {
            statements.Add(
                $"ALTER TABLE {table} ADD CONSTRAINT {Quote(check.Name)} " +
                $"CHECK ({check.Expression.Trim()});");
        }

        foreach (var foreignKey in alteration.AddedForeignKeys)
        {
            statements.Add($"ALTER TABLE {table} ADD {ForeignKeyBody(foreignKey)};");
        }

        foreach (var index in alteration.AddedIndexes)
        {
            statements.Add(CreateIndex(table, alteration.Table, index));
        }

        foreach (var change in alteration.AlteredIndexes)
        {
            statements.Add(CreateIndex(table, alteration.Table, change.Index));
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

        // Con una transacción manual abierta hay que unirse a ella aunque el
        // motor no prometa DDL transaccional: los comandos van por esa conexión
        // y dejarlos sueltos daría «hay una transacción en curso».
        //
        // **En MySQL eso no significa que el DDL se pueda deshacer**: hace un
        // commit implícito antes de cada `ALTER`, así que un `CREATE TABLE`
        // dentro de la transacción del usuario queda hecho aunque pulse Rollback.
        // Se ejecuta igual porque la alternativa es no funcionar, pero quien
        // llama debe avisarlo.
        await using var scope = SupportsTransactionalDdl || session.Transaction.IsOpen
            ? await OperationScope.BeginAsync(connection, session.Transaction, cancellationToken)
            : null;

        foreach (var sql in statements)
        {
            await using var command = connection.CreateCommand();
            command.CommandText = sql;
            command.Transaction = scope?.Transaction;

            await command.ExecuteNonQueryAsync(cancellationToken);
        }

        if (scope is not null)
        {
            await scope.CommitAsync(cancellationToken);
        }

        stopwatch.Stop();

        return new TableChangeResult(statements, stopwatch.Elapsed);
    }

    /// <summary>Una línea de la definición, ya indentada para el `CREATE TABLE`.</summary>
    protected string ColumnDefinition(TableColumnDefinition column)
    {
        var parts = new List<string> { $"  {Quote(column.Name)}", DataTypeOf(column) };

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
