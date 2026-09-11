using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Runtime.CompilerServices;
using System.Text;
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
///
/// **También guioniza lo que ya existe** (<see cref="IDatabaseScripter"/>), y no
/// por comodidad: escribir un `CREATE TABLE` desde un diseño y escribirlo desde el
/// catálogo son la misma tarea con distinta entrada. Separarlo en otra clase por
/// motor habría duplicado cuatro veces el modo de citar, la cláusula de identidad
/// y el cuerpo de una clave foránea, y dos copias de un dialecto se separan a la
/// primera corrección que solo se aplica en una.
/// </summary>
public abstract class TableDesignerBase : ITableDesigner, IDatabaseScripter
{
    public abstract DatabaseEngine Engine { get; }

    public abstract IReadOnlyList<string> CommonDataTypes { get; }

    public abstract IndexCapabilities IndexCapabilities { get; }

    /// <summary>
    /// Cómo llama este motor al tipo que guarda esto.
    ///
    /// Sin implementación común: es dialecto puro, y una respuesta por omisión
    /// sería la de un motor concreto disfrazada de regla general.
    /// </summary>
    public abstract string TypeFor(TypeFacets facets);

    /// <summary>Cita un identificador en el dialecto del motor.</summary>
    protected abstract string Quote(string identifier);

    /// <summary>
    /// Qué dice el motor cuando rechaza una instrucción, ya en limpio.
    ///
    /// Lo traduce cada proveedor con el mismo normalizador que usan las
    /// consultas: así un error del diseñador se lee igual que uno del editor, y
    /// **no arrastra la cadena de conexión** hasta la pantalla.
    /// </summary>
    protected abstract QueryError Normalize(Exception exception);

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

    /// <summary>
    /// Añade una restricción con nombre a una tabla.
    ///
    /// El cuerpo llega ya escrito —`PRIMARY KEY (…)`, `UNIQUE (…)`, `CHECK (…)`
    /// o la clave foránea entera— y aquí solo se le pone el nombre delante, que
    /// es como lo escriben PostgreSQL, SQL Server y MySQL. Informix lo pone
    /// detrás y por eso esto es un punto de extensión y no texto fijo.
    /// </summary>
    protected virtual string AddConstraint(string qualifiedTable, string name, string body) =>
        $"ALTER TABLE {qualifiedTable} ADD {NamedConstraint(name, body)};";

    /// <summary>
    /// Una restricción con su nombre, tal como se escribe dentro de un
    /// `CREATE TABLE` o detrás de un `ADD`.
    ///
    /// Es el único sitio donde se decide de qué lado va el nombre, y por eso lo
    /// comparten la creación y la alteración: en Informix va detrás del cuerpo.
    /// </summary>
    protected virtual string NamedConstraint(string name, string body) =>
        $"CONSTRAINT {Quote(name)} {body}";

    /// <summary>El cuerpo de una clave foránea, sin el `ALTER TABLE` ni el nombre.</summary>
    protected string ForeignKeyBody(ForeignKeyDefinition key)
    {
        ArgumentNullException.ThrowIfNull(key);

        // Sin columnas referenciadas se escribe solo la tabla, y el motor usa su
        // clave primaria. No es un atajo: el catálogo de Informix no las entrega
        // —leerlas costaría una consulta por cada clave foránea sobre una conexión
        // que no admite dos a la vez— y `REFERENCES padre ()` no lo acepta nadie.
        var references = key.ReferencedColumns.Count > 0
            ? $"REFERENCES {QualifyReference(key)} " +
              $"({string.Join(", ", key.ReferencedColumns.Select(Quote))})"
            : $"REFERENCES {QualifyReference(key)}";

        var body =
            $"FOREIGN KEY " +
            $"({string.Join(", ", key.Columns.Select(Quote))}) " +
            references;

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
    public virtual bool SupportsTransactionalDdl => true;

    public IReadOnlyList<string> DescribeCreate(TableDefinition table)
    {
        ArgumentNullException.ThrowIfNull(table);

        var qualified = Qualify(table.Database, table.Schema, table.Name);
        var lines = table.Columns.Select(ColumnDefinition).ToList();
        var key = table.PrimaryKeyColumns;

        if (key.Count > 0)
        {
            var body = $"PRIMARY KEY ({string.Join(", ", key.Select(Quote))})";

            // El nombre solo se escribe si quien pide la tabla lo trae. El
            // diseñador no lo trae —deja que lo ponga el motor— y quien reproduce
            // una tabla existente sí, para no perderlo por el camino.
            lines.Add(table.PrimaryKey?.Name is { Length: > 0 } name
                ? $"  {NamedConstraint(name, body)}"
                : $"  {body}");
        }

        // Las restricciones caben dentro del paréntesis y los índices no: es la
        // única diferencia entre unas y otros a la hora de crear la tabla.
        //
        // Todas pasan por `NamedConstraint`, que es el único sitio que sabe de qué
        // lado va el nombre. Escribirlo aquí a mano funcionaba en tres motores y
        // rompía en Informix, donde va detrás del cuerpo.
        foreach (var unique in table.UniqueConstraints)
        {
            var body = $"UNIQUE ({string.Join(", ", unique.Columns.Select(Quote))})";

            // Sin nombre, lo pone el motor. Es lo que pide quien reproduce una
            // tabla de un motor que no deja leer el nombre real de la restricción.
            lines.Add(unique.Name.Length > 0
                ? $"  {NamedConstraint(unique.Name, body)}"
                : $"  {body}");
        }

        foreach (var check in table.CheckConstraints.Where(_ => IndexCapabilities.SupportsCheckConstraints))
        {
            var body = $"CHECK ({check.Expression.Trim()})";

            // Sin nombre se escribe sin nombre, igual que las de unicidad.
            // Importa al reproducir una tabla que ya existe: SQLite no les pone
            // nombre, y ponérselo aquí le cambiaría su `CREATE TABLE` por el
            // camino.
            lines.Add(check.Name.Length > 0
                ? $"  {NamedConstraint(check.Name, body)}"
                : $"  {body}");
        }

        foreach (var foreignKey in table.ForeignKeys)
        {
            lines.Add($"  {NamedConstraint(foreignKey.Name, ForeignKeyBody(foreignKey))}");
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
            var body = $"PRIMARY KEY ({string.Join(", ", primaryKey.Columns.Select(Quote))})";

            statements.Add(primaryKey.Name is null
                ? $"ALTER TABLE {table} ADD {body};"
                : AddConstraint(table, primaryKey.Name, body));
        }

        foreach (var unique in alteration.AddedUniqueConstraints)
        {
            statements.Add(AddConstraint(
                table,
                unique.Name,
                $"UNIQUE ({string.Join(", ", unique.Columns.Select(Quote))})"));
        }

        foreach (var check in alteration.AddedCheckConstraints)
        {
            statements.Add(AddConstraint(table, check.Name, $"CHECK ({check.Expression.Trim()})"));
        }

        foreach (var foreignKey in alteration.AddedForeignKeys)
        {
            statements.Add(AddConstraint(table, foreignKey.Name, ForeignKeyBody(foreignKey)));
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

    // -----------------------------------------------------------------------
    // Guionizado de lo que ya existe (IDatabaseScripter)
    // -----------------------------------------------------------------------

    /// <summary>
    /// Lo que este motor conserva de lo guionizado. Por omisión, todo.
    ///
    /// Solo lo redefine quien pierde algo por el camino, y entonces lo declara en
    /// vez de escribir DDL que el motor acepta y luego no respeta.
    /// </summary>
    public virtual ScripterCapabilities Capabilities { get; } = new();

    /// <summary>
    /// Por omisión no se crea nada: solo lo redefine el motor donde el esquema es
    /// un objeto aparte de la base.
    /// </summary>
    public virtual IReadOnlyList<string> ScriptSchema(string schema) => [];

    /// <summary>
    /// El `CREATE DATABASE` de una base nueva donde volcar un respaldo.
    ///
    /// Es igual en tres de los cuatro motores; Informix lo amplía porque allí una
    /// base sin registro de transacciones no admite conexiones DRDA.
    /// </summary>
    public virtual IReadOnlyList<string> ScriptCreateDatabase(string name)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(name);

        return [$"CREATE DATABASE {Quote(name)}"];
    }

    /// <summary>
    /// La misma tabla, nombrada como hay que nombrarla **dentro de un artefacto**.
    ///
    /// Un respaldo no pertenece a la base de la que salió: se aplica donde el
    /// usuario diga. Por omisión no hay nada que quitar —`public` y `dbo` son
    /// esquemas dentro de cualquier base, y el propietario de Informix tampoco es
    /// una base—, así que solo lo redefine el motor donde el esquema **es** la
    /// base.
    ///
    /// Lo aplican los tres métodos de guionizado y los `INSERT`, que es todo lo
    /// que acaba escrito en el artefacto. Lo que se lee del origen conserva el
    /// nombre completo: la tabla puede estar en otra base del mismo servidor.
    /// </summary>
    protected virtual ScriptedTable Portable(ScriptedTable table) => table;

    public IReadOnlyList<string> ScriptTable(ScriptedTable table) =>
        DescribeCreate(ToDefinition(Portable(table)));

    /// <summary>
    /// Manda una instrucción del artefacto por la conexión de la sesión.
    ///
    /// Se une a la transacción manual si el usuario tiene una abierta —los
    /// comandos van por esa misma conexión y dejarlos fuera daría «hay una
    /// transacción en curso»— pero no abre ninguna por su cuenta: quién decide
    /// eso es la restauración, y decidió que no (ver el contrato).
    /// </summary>
    public async Task<long> ApplyAsync(
        IDatabaseSession session,
        string statement,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentException.ThrowIfNullOrWhiteSpace(statement);

        await using var command = Connection(session).CreateCommand();

        command.CommandText = ToCommand(statement);
        command.Transaction = session.Transaction.Current;

        var affected = await command.ExecuteNonQueryAsync(cancellationToken);

        // Un `CREATE TABLE` devuelve -1 en casi todos los proveedores: no son
        // filas escritas, son «esto no contaba filas».
        //
        // Y en SQLite devuelve **1**, que es peor que -1 porque parece un dato:
        // el driver contesta con el contador de cambios de la conexión, que una
        // instrucción de definición no pone a cero. Quien restaura un artefacto ve
        // entonces filas escritas donde solo se creó una tabla vacía, así que lo
        // que manda es lo que la instrucción es, no lo que el driver conteste.
        return !WritesRows(statement) || affected < 0 ? 0 : affected;
    }

    /// <summary>
    /// Si esta instrucción puede haber escrito filas.
    ///
    /// Se mira por lo que **no** las escribe —definir, borrar un objeto, dar
    /// permisos— y no por lo que sí: la lista de lo que escribe tiene casos con
    /// los que no vale mirar la primera palabra, empezando por un `WITH … INSERT`.
    /// Equivocarse aquí solo puede sobrar, nunca faltar: lo que no se reconozca
    /// sigue devolviendo lo que diga el motor.
    /// </summary>
    private static bool WritesRows(string statement)
    {
        var word = statement.AsSpan().TrimStart();
        var end = word.IndexOfAny(" \t\r\n(".AsSpan());

        if (end > 0)
        {
            word = word[..end];
        }

        return !(word.Equals("CREATE", StringComparison.OrdinalIgnoreCase)
            || word.Equals("ALTER", StringComparison.OrdinalIgnoreCase)
            || word.Equals("DROP", StringComparison.OrdinalIgnoreCase)
            || word.Equals("COMMENT", StringComparison.OrdinalIgnoreCase)
            || word.Equals("GRANT", StringComparison.OrdinalIgnoreCase)
            || word.Equals("REVOKE", StringComparison.OrdinalIgnoreCase)
            || word.Equals("PRAGMA", StringComparison.OrdinalIgnoreCase));
    }

    public IReadOnlyList<string> ScriptIndexes(ScriptedTable table)
    {
        ArgumentNullException.ThrowIfNull(table);

        table = Portable(table);

        var qualified = Qualify(table.Table.Database, table.Table.Schema, table.Table.Name);

        // El índice que sostiene una clave primaria o una restricción de unicidad
        // ya se creó con ella dentro del `CREATE TABLE`. Volver a escribirlo lo
        // rechazan los cuatro motores: el nombre ya está ocupado.
        return
        [
            .. table.Structure.Indexes
                .Where(index => !index.IsConstraintIndex && !index.IsPrimaryKey)
                .Select(index => Script(qualified, table.Table, index))
                .OfType<string>(),
        ];
    }

    /// <summary>
    /// Un índice, escrito para poder recrearlo.
    ///
    /// Devuelve `null` cuando **no se puede reproducir**: un índice sobre una
    /// expresión no tiene columnas que enumerar, y escribirlo igual produce un
    /// `USING btree ()` que el motor rechaza. Ahí es mejor un respaldo con un
    /// índice de menos —y su aviso— que uno entero que no se puede aplicar.
    /// </summary>
    private string? Script(string qualified, DatabaseObject table, DatabaseIndex index)
    {
        // La definición del propio motor gana: reproduce expresiones, operadores
        // y todo lo que la lista de columnas no sabe decir.
        if (!string.IsNullOrWhiteSpace(index.Definition))
        {
            return index.Definition.TrimEnd().TrimEnd(';') + ";";
        }

        return index.Columns.Count > 0
            ? CreateIndex(qualified, table, ToDefinition(index))
            : null;
    }

    public IReadOnlyList<string> ScriptForeignKeys(ScriptedTable table)
    {
        ArgumentNullException.ThrowIfNull(table);

        table = Portable(table);

        var qualified = Qualify(table.Table.Database, table.Table.Schema, table.Table.Name);

        // Donde no se pueden colgar después, ya viajaron dentro del `CREATE
        // TABLE`: escribirlas aquí sería escribirlas dos veces, y en el motor que
        // obliga a eso —SQLite— la instrucción ni siquiera existe.
        if (!Capabilities.AddsForeignKeysAfterwards)
        {
            return [];
        }

        return
        [
            .. table.Structure.ForeignKeys.Select(key =>
                AddConstraint(qualified, key.Name, ForeignKeyBody(ToDefinition(key)))),
        ];
    }

    /// <summary>
    /// El `DELETE` que deja la tabla vacía, sin condición.
    ///
    /// Igual en los cuatro motores, y a propósito: lo que cambia entre ellos es
    /// cómo se cita el nombre, que ya resuelve <see cref="Qualify"/>.
    /// </summary>
    public virtual IReadOnlyList<string> ScriptClearTable(ScriptedTable table)
    {
        ArgumentNullException.ThrowIfNull(table);

        return
        [
            $"DELETE FROM {Qualify(table.Table.Database, table.Table.Schema, table.Table.Name)};",
        ];
    }

    /// <summary>
    /// Lo que hay que ejecutar antes de cargar filas. Por omisión, nada.
    /// </summary>
    public virtual IReadOnlyList<string> BeginDataLoad(ScriptedTable table) => [];

    /// <summary>Lo que cierra lo que abrió <see cref="BeginDataLoad"/>.</summary>
    public virtual IReadOnlyList<string> EndDataLoad(ScriptedTable table) => [];

    public string SelectData(ScriptedTable table, TableDataFilter filter)
    {
        ArgumentNullException.ThrowIfNull(table);
        ArgumentNullException.ThrowIfNull(filter);

        Check(table, filter);

        return SelectRows(
            Qualify(table.Table.Database, table.Table.Schema, table.Table.Name),
            Included(table, filter),
            table,
            filter);
    }

    /// <summary>
    /// El filtro se comprueba antes de armar el `SELECT`, no después de
    /// ejecutarlo: es texto que escribió una persona y va dentro de una
    /// instrucción que escribe Druse.
    /// </summary>
    private static void Check(ScriptedTable table, TableDataFilter filter)
    {
        var problems = filter.Validate(table);

        if (problems.Count > 0)
        {
            throw new ArgumentException(
                $"El filtro de «{table.Table.Name}» no se puede aplicar: {string.Join(" ", problems)}",
                nameof(filter));
        }
    }

    public async Task<IBackupSnapshot> BeginSnapshotAsync(
        IDatabaseSession session,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);

        // Con una transacción del usuario abierta se lee dentro de ella: es lo que
        // esa sesión ve, incluidos sus cambios sin confirmar, y abrir otra sobre la
        // misma conexión no lo admite ningún motor.
        if (session.Transaction is { IsOpen: true, Current: { } manual })
        {
            return new BorrowedSnapshot(manual);
        }

        var connection = Connection(session);

        // Se pregunta al motor en vez de suponerlo: el nivel declarado es el que
        // este dialecto *querría*, no el que la base concreta va a conceder.
        var isolation = await ResolveIsolationAsync(connection, cancellationToken);

        if (isolation == BackupIsolation.None)
        {
            return new BorrowedSnapshot(null);
        }

        var level = isolation switch
        {
            BackupIsolation.Snapshot => System.Data.IsolationLevel.Snapshot,
            BackupIsolation.Serializable => System.Data.IsolationLevel.Serializable,
            _ => System.Data.IsolationLevel.RepeatableRead,
        };

        try
        {
            // Se le presta a la sesión: los comandos que salgan mientras dure
            // —el catálogo de cada tabla, las filas— tienen que llevarla puesta,
            // o MySQL e Informix los rechazan por tener la conexión ocupada.
            return new OwnedSnapshot(
                session.Transaction,
                await connection.BeginTransactionAsync(level, cancellationToken));
        }
        // `ArgumentException` está porque ODP.NET rechaza así los niveles que no
        // admite —`ORA-50002`— en vez de con una excepción de base de datos.
        catch (Exception error)
            when (error is DbException or InvalidOperationException or NotSupportedException
                  or ArgumentException)
        {
            // Pasa de verdad: una base de SQL Server sin `ALLOW_SNAPSHOT_ISOLATION`
            // rechaza la transacción. El respaldo sigue sin garantía y **lo dice en
            // su manifiesto**, que es mejor que no llegar a empezar.
            return new BorrowedSnapshot(null);
        }
    }

    /// <summary>
    /// Qué aislamiento concede **esta base**, que no siempre es el que el motor
    /// ofrece sobre el papel.
    ///
    /// Por omisión, el declarado. Lo redefine quien tenga que preguntárselo al
    /// servidor antes de pedirlo, y hay que preguntar cuando pedirlo de más no
    /// degrada sino que rompe.
    /// </summary>
    protected virtual Task<BackupIsolation> ResolveIsolationAsync(
        DbConnection connection,
        CancellationToken cancellationToken) =>
        Task.FromResult(Capabilities.Isolation);

    /// <summary>Instantánea propia: se abrió aquí y aquí se cierra.</summary>
    private sealed class OwnedSnapshot : IBackupSnapshot
    {
        private readonly SessionTransaction _session;
        private readonly DbTransaction _transaction;

        public OwnedSnapshot(SessionTransaction session, DbTransaction transaction)
        {
            _session = session;
            _transaction = transaction;

            _session.Borrow(transaction);
        }

        public DbTransaction? Transaction => _transaction;

        public bool IsConsistent => true;

        public async ValueTask DisposeAsync()
        {
            // Se devuelve antes de deshacerla: dejarla anunciada un instante más
            // sería ofrecer a los comandos una transacción ya muerta.
            _session.Return();

            // Solo se ha leído: deshacerla es la forma de soltarla sin escribir.
            await _transaction.RollbackAsync();
            await _transaction.DisposeAsync();
        }
    }

    /// <summary>
    /// Instantánea prestada, o ninguna.
    ///
    /// No cierra nada: o la transacción es del usuario y solo él la termina, o no
    /// hubo forma de abrir una y entonces no hay garantía que cerrar.
    /// </summary>
    private sealed class BorrowedSnapshot(DbTransaction? transaction) : IBackupSnapshot
    {
        public DbTransaction? Transaction => transaction;

        public bool IsConsistent => false;

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }

    public async IAsyncEnumerable<ScriptedRows> ScriptDataAsync(
        IDatabaseSession session,
        ScriptedTable table,
        TableDataFilter filter,
        IBackupSnapshot? snapshot,
        [EnumeratorCancellation] CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);
        ArgumentNullException.ThrowIfNull(table);
        ArgumentNullException.ThrowIfNull(filter);

        Check(table, filter);

        var columns = Included(table, filter);

        if (columns.Count == 0)
        {
            yield break;
        }

        // Se lee de donde está y se escribe adonde se restaure: no son el mismo
        // nombre. La tabla puede estar en otra base del mismo servidor, así que
        // el `SELECT` la nombra entera; el `INSERT` va al artefacto y ahí el
        // nombre de la base de origen sobraría.
        var source = Qualify(table.Table.Database, table.Table.Schema, table.Table.Name);
        var written = Portable(table).Table;
        var qualified = Qualify(written.Database, written.Schema, written.Name);

        var header =
            $"INSERT INTO {qualified} " +
            $"({string.Join(", ", columns.Select(column => Quote(column.Name)))}) VALUES";

        var connection = Connection(session);

        // La lectura va bajo la instantánea del respaldo cuando la hay: todas las
        // tablas tienen que verse en el mismo instante. Sin ella —una tabla
        // suelta, una vista previa— se abre una transacción propia que se descarta
        // al terminar, o se lee dentro de la del usuario si la tiene abierta.
        await using var scope = snapshot is null
            ? await OperationScope.BeginAsync(connection, session.Transaction, cancellationToken)
            : null;

        await using var command = connection.CreateCommand();
        command.CommandText = SelectRows(source, columns, table, filter);
        command.Transaction = snapshot?.Transaction ?? scope?.Transaction;

        // SequentialAccess deja liberar cada fila según se lee, en lugar de
        // mantener el registro entero en memoria.
        await using var reader = await command.ExecuteReaderAsync(
            System.Data.CommandBehavior.SequentialAccess,
            cancellationToken);

        var batch = new List<string>(Math.Max(1, Capabilities.MaxRowsPerInsert));
        var values = new string[columns.Count];

        while (await reader.ReadAsync(cancellationToken))
        {
            for (var ordinal = 0; ordinal < columns.Count; ordinal++)
            {
                var value = await reader.IsDBNullAsync(ordinal, cancellationToken)
                    ? null
                    : reader.GetValue(ordinal);

                values[ordinal] = FormatLiteral(value, columns[ordinal]);
            }

            batch.Add($"({string.Join(", ", values)})");

            if (batch.Count >= Math.Max(1, Capabilities.MaxRowsPerInsert))
            {
                yield return new ScriptedRows(Insert(header, batch), batch.Count);
                batch.Clear();
            }
        }

        if (batch.Count > 0)
        {
            yield return new ScriptedRows(Insert(header, batch), batch.Count);
        }
    }

    private static string Insert(string header, List<string> rows) =>
        rows.Count == 1
            ? $"{header} {rows[0]};"
            : $"{header}{Environment.NewLine}" +
              $"{string.Join("," + Environment.NewLine, rows.Select(row => $"  {row}"))};";

    /// <summary>Las columnas que se copian, en el orden de la tabla.</summary>
    private static IReadOnlyList<DatabaseColumn> Included(
        ScriptedTable table,
        TableDataFilter filter) =>
        [
            .. table.Columns
                .Where(column => !filter.ExcludedColumns.Contains(column.Name, StringComparer.Ordinal))
                .OrderBy(column => column.Ordinal),
        ];

    /// <summary>
    /// La consulta que lee las filas que hay que copiar.
    ///
    /// Con límite se ordena por la clave primaria si la hay: sin un orden, «las
    /// primeras mil filas» son mil filas cualesquiera, distintas en cada respaldo,
    /// y una muestra que no se puede reproducir no sirve para comparar nada.
    /// </summary>
    protected virtual string SelectRows(
        string qualifiedTable,
        IReadOnlyList<DatabaseColumn> columns,
        ScriptedTable table,
        TableDataFilter filter)
    {
        ArgumentNullException.ThrowIfNull(columns);
        ArgumentNullException.ThrowIfNull(table);
        ArgumentNullException.ThrowIfNull(filter);

        var limit = filter.MaxRows;
        var sql = new StringBuilder("SELECT ");

        if (limit is { } prefixRows && RowLimitPrefix(prefixRows) is { Length: > 0 } prefix)
        {
            sql.Append(prefix).Append(' ');
        }

        sql.Append(string.Join(", ", columns.Select(column => Quote(column.Name))));
        sql.Append(" FROM ").Append(qualifiedTable);

        if (!string.IsNullOrWhiteSpace(filter.Where))
        {
            sql.Append(" WHERE ").Append(filter.Where.Trim());
        }

        if (limit is not null && table.Structure.PrimaryKey is { Columns.Count: > 0 } key)
        {
            sql.Append(" ORDER BY ").Append(string.Join(", ", key.Columns.Select(Quote)));
        }

        if (limit is { } suffixRows && RowLimitSuffix(suffixRows) is { Length: > 0 } suffix)
        {
            sql.Append(' ').Append(suffix);
        }

        return sql.ToString();
    }

    /// <summary>
    /// La instrucción tal y como hay que mandarla al servidor.
    ///
    /// Lo que se escribe aquí arriba lleva punto y coma, y así tiene que ser: un
    /// guion de respaldo se parte por él, y lo que se le enseña al usuario antes
    /// de aplicar un cambio de tabla es lo que él escribiría. Pero **hay motores
    /// que no lo aceptan por el cable** —Oracle responde `ORA-00911`— y la
    /// diferencia no es de dialecto: es de dónde va el texto.
    ///
    /// Por eso el terminador se quita aquí y no en cada sitio donde se compone
    /// una instrucción: son diez, y bastaría olvidarse de uno para que el motor
    /// rechazara justo el cambio que nadie probó.
    /// </summary>
    protected virtual string ToCommand(string statement) => statement;

    /// <summary>Lo que va entre `SELECT` y las columnas para limitar filas: `TOP`, `FIRST`.</summary>
    protected virtual string RowLimitPrefix(int maxRows) => string.Empty;

    /// <summary>Lo que va al final para limitar filas. `LIMIT` en la mayoría.</summary>
    protected virtual string RowLimitSuffix(int maxRows) =>
        $"LIMIT {maxRows.ToString(CultureInfo.InvariantCulture)}";

    public virtual string FormatLiteral(object? value, DatabaseColumn column)
    {
        ArgumentNullException.ThrowIfNull(column);

        if (value is null or DBNull)
        {
            return "NULL";
        }

        var invariant = CultureInfo.InvariantCulture;

        // Manda el tipo de la columna, no el que traiga el valor. Un booleano no
        // siempre llega como booleano: **Informix lo entrega como `SMALLINT`**
        // porque DRDA no lo distingue de un entero pequeño, y escribir un `1` en
        // una columna `BOOLEAN` lo rechaza el propio motor. Lo que sabe la verdad
        // es el catálogo.
        if (ColumnValueParser.Classify(column.DataType) == ColumnFamily.Boolean &&
            value is not string)
        {
            return BooleanLiteral(Convert.ToInt64(value, invariant) != 0);
        }

        return value switch
        {
            bool flag => BooleanLiteral(flag),
            byte[] binary => BinaryLiteral(binary),
            string text => TextLiteral(text),
            char character => TextLiteral(character.ToString()),
            Guid uuid => TextLiteral(uuid.ToString()),

            // Los mismos formatos con los que se muestran los valores en la
            // cuadrícula y se exportan a CSV: una fecha tiene que leerse igual
            // venga del motor que venga.
            DateTime timestamp => TextLiteral(
                timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFF", invariant)),
            DateTimeOffset timestamp => TextLiteral(
                timestamp.ToString("yyyy-MM-dd HH:mm:ss.FFFFFFFzzz", invariant)),
            DateOnly date => TextLiteral(date.ToString("yyyy-MM-dd", invariant)),
            TimeOnly time => TextLiteral(time.ToString("HH:mm:ss.FFFFFFF", invariant)),
            TimeSpan interval => TextLiteral(interval.ToString()),

            // Los números van sin comillas y con cultura invariante. Escribir
            // `3,5` porque la máquina usa coma decimal produciría un respaldo que
            // se restaura como 35 en otro equipo, o que ni siquiera se ejecuta.
            byte or sbyte or short or ushort or int or uint or long or ulong
                or decimal or float or double
                => ((IFormattable)value).ToString(null, invariant),

            _ => TextLiteral(Convert.ToString(value, invariant) ?? string.Empty),
        };
    }

    /// <summary>
    /// Un texto entre comillas, con las comillas de dentro duplicadas.
    ///
    /// Es lo que impide que el contenido de una fila se convierta en instrucción.
    /// Los motores que además tratan la barra invertida como escape lo redefinen.
    /// </summary>
    protected virtual string TextLiteral(string text)
    {
        ArgumentNullException.ThrowIfNull(text);

        return $"'{text.Replace("'", "''", StringComparison.Ordinal)}'";
    }

    /// <summary>Cómo escribe este motor un valor de verdad o falso.</summary>
    protected virtual string BooleanLiteral(bool value) => value ? "true" : "false";

    /// <summary>Cómo escribe este motor una tira de bytes.</summary>
    protected virtual string BinaryLiteral(byte[] value)
    {
        ArgumentNullException.ThrowIfNull(value);

        if (!Capabilities.SupportsBinaryLiterals)
        {
            throw new NotSupportedException(
                $"{Engine} no sabe escribir un valor binario dentro de una instrucción, " +
                "así que esa columna no se puede respaldar como texto.");
        }

        return $"0x{Convert.ToHexString(value)}";
    }

    /// <summary>
    /// La tabla leída, escrita como diseño para poder reutilizar
    /// <see cref="DescribeCreate"/>.
    ///
    /// Va sin índices ni claves foráneas a propósito: así `DescribeCreate` produce
    /// una sola instrucción —el `CREATE TABLE`— y el resto se escribe cuando toca,
    /// que es después de los datos.
    /// </summary>
    private TableDefinition ToDefinition(ScriptedTable table)
    {
        ArgumentNullException.ThrowIfNull(table);

        var key = table.Structure.PrimaryKey;
        var keyColumns = key?.Columns ?? [];

        return new TableDefinition
        {
            Database = table.Table.Database,
            Schema = table.Table.Schema,
            Name = table.Table.Name,
            PrimaryKey = key is null
                ? null
                : new PrimaryKeyDefinition
                {
                    Name = Capabilities.NamesPrimaryKey ? key.Name : null,
                    Columns = key.Columns,
                },
            Columns =
            [
                .. table.Columns
                    .OrderBy(column => column.Ordinal)
                    .Select(column => new TableColumnDefinition
                    {
                        Name = column.Name,
                        DataType = column.DataType,
                        IsNullable = column.IsNullable,
                        IsPrimaryKey = keyColumns.Contains(column.Name, StringComparer.Ordinal),
                        IsIdentity = column.IsGenerated,

                        // Una columna que genera su valor no lleva además un valor
                        // por omisión: en PostgreSQL el catálogo devuelve ahí el
                        // `nextval` de su secuencia, y escribirlo junto a la
                        // cláusula de identidad produce una tabla que el motor
                        // rechaza o que queda con dos generadores.
                        DefaultValue = column.IsGenerated ? null : column.DefaultValue,
                    }),
            ],
            UniqueConstraints =
            [
                .. table.Structure.UniqueConstraints.Select(unique =>
                    new UniqueConstraintDefinition
                    {
                        Name = Capabilities.NamesUniqueConstraints ? unique.Name : string.Empty,
                        Columns = unique.Columns,
                    }),
            ],
            CheckConstraints =
            [
                .. table.Structure.CheckConstraints.Select(check =>
                    new CheckConstraintDefinition
                    {
                        Name = check.Name,
                        Expression = check.Expression,
                    }),
            ],

            // Normalmente vacías: las claves foráneas se cuelgan después, con la
            // tabla a la que apuntan ya creada. Donde no se puede —SQLite no tiene
            // `ALTER TABLE … ADD CONSTRAINT`— es aquí o en ningún sitio.
            ForeignKeys = Capabilities.AddsForeignKeysAfterwards
                ? []
                : [.. table.Structure.ForeignKeys.Select(ToDefinition)],
        };
    }

    private static IndexDefinition ToDefinition(DatabaseIndex index) => new()
    {
        Name = index.Name,
        Columns = index.Columns,
        IsUnique = index.IsUnique,
        IncludedColumns = index.IncludedColumns,
        Filter = index.Filter,
        Method = index.Method,
    };

    private static ForeignKeyDefinition ToDefinition(DatabaseForeignKey key) => new()
    {
        Name = key.Name,
        Columns = key.Columns,
        ReferencedSchema = key.ReferencedSchema,
        ReferencedTable = key.ReferencedTable,
        ReferencedColumns = key.ReferencedColumns,
        OnDelete = key.OnDelete,
        OnUpdate = key.OnUpdate,
    };

    public Task<TableChangeResult> CreateAsync(
        IDatabaseSession session,
        TableDefinition table,
        CancellationToken cancellationToken) =>
        ExecuteAsync(session, DescribeCreate(table), alteration: null, cancellationToken);

    /// <summary>
    /// Lo mismo que <see cref="DescribeAlter"/>, con la sesión a mano.
    ///
    /// La implementa aquí y no se hereda de la interfaz porque una clase no ve
    /// los miembros por omisión de sus interfaces sin convertirse a ellas. Los
    /// cinco motores que no necesitan mirar la tabla se quedan con esto; SQLite
    /// lo reescribe, y el porqué está en <see cref="ITableDesigner"/>.
    /// </summary>
    public virtual Task<IReadOnlyList<string>> DescribeAlterAsync(
        IDatabaseSession session,
        TableAlteration alteration,
        CancellationToken cancellationToken) =>
        Task.FromResult(DescribeAlter(alteration));

    public async Task<TableChangeResult> AlterAsync(
        IDatabaseSession session,
        TableAlteration alteration,
        CancellationToken cancellationToken) =>
        await ExecuteAsync(
            session,
            // La versión que puede mirar la tabla, no la que no. Son la misma en
            // cinco de los seis motores; en SQLite es la diferencia entre cambiar
            // una columna y no poder.
            await DescribeAlterAsync(session, alteration, cancellationToken),
            alteration,
            cancellationToken);

    /// <summary>
    /// Lo que haya que preparar en la conexión **antes de abrir la transacción**,
    /// y deshacer al terminar.
    ///
    /// Existe por un caso concreto y real: hay ajustes de sesión que un motor
    /// ignora en silencio si ya hay una transacción en curso. En SQLite,
    /// `PRAGMA foreign_keys` es uno de ellos, y reconstruir una tabla con las
    /// claves foráneas encendidas **borra las filas de sus tablas hijas** por la
    /// cascada del `DROP TABLE`. Hecho dentro de la transacción, el pragma no
    /// hace nada y nadie se entera.
    ///
    /// Por omisión no hay nada que preparar: devuelve `null` y los cinco motores
    /// restantes no pagan ni una consulta. Lo que se devuelva se libera **después
    /// de la transacción**, haya terminado bien o mal.
    /// </summary>
    protected virtual Task<IAsyncDisposable?> PrepareChangeAsync(
        IDatabaseSession session,
        TableAlteration? alteration,
        CancellationToken cancellationToken) =>
        Task.FromResult<IAsyncDisposable?>(null);

    /// <summary>
    /// Lo que hay que mirar **antes de confirmar**, cuando el motor no lo mira solo.
    ///
    /// Existe porque hay comprobaciones que no se pueden escribir como una
    /// instrucción más: `PRAGMA foreign_key_check` de SQLite devuelve las filas
    /// que sobran en vez de fallar, así que ejecutarlo entre las demás lo dejaría
    /// pasar sin que nadie leyera su respuesta.
    ///
    /// Lanzar desde aquí deshace el cambio entero, que es lo que se quiere: un
    /// cambio que deja la base en un estado que el motor no acepta no es un cambio
    /// a medias, es un cambio que no se hace.
    ///
    /// Por omisión no hay nada que mirar.
    /// </summary>
    protected virtual Task VerifyChangeAsync(
        IDatabaseSession session,
        TableAlteration? alteration,
        DbTransaction? transaction,
        CancellationToken cancellationToken) =>
        Task.CompletedTask;

    /// <summary>
    /// El mismo error del motor, contado según **en qué paso** se produjo.
    ///
    /// Hay errores que significan cosas distintas según dónde salgan, y el motor
    /// no distingue. «CHECK constraint failed» al insertar una fila habla de esa
    /// fila; el mismo error al copiar las filas de una tabla que se está
    /// reconstruyendo habla de **las que ya estaban**, que es otra conversación y
    /// otra decisión.
    ///
    /// Es además el único sitio con lo que hace falta para **escribir la consulta
    /// que enseña las filas culpables**: el paso dice qué se estaba haciendo y el
    /// cambio pedido dice sobre qué. De ahí que reciba la alteración entera.
    ///
    /// Por omisión no se toca: el motor lo dijo bien.
    /// </summary>
    protected virtual QueryError Explain(
        QueryError failure,
        string statement,
        TableAlteration? alteration) => failure;

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
        TableAlteration? alteration,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(session);

        var connection = Connection(session);
        var stopwatch = Stopwatch.StartNew();

        // Se declara antes que la transacción **para liberarse después**: `await
        // using` deshace en orden inverso, así que lo que esto prepare sigue en
        // pie mientras la transacción vive y se restaura cuando ya no.
        await using var preparation = await PrepareChangeAsync(
            session,
            alteration,
            cancellationToken);

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

        var applied = new List<string>();

        foreach (var sql in statements)
        {
            await using var command = connection.CreateCommand();
            command.CommandText = ToCommand(sql);
            command.Transaction = scope?.Transaction;

            try
            {
                await command.ExecuteNonQueryAsync(cancellationToken);
            }
            catch (Exception error) when (error is not OperationCanceledException)
            {
                // Lo que hace falta saber al fallar un cambio de tabla no es solo
                // el motivo: es **cuál** de las instrucciones falló y qué pasa con
                // las anteriores. Donde el motor no deshace el DDL, esas se
                // quedan, y la tabla ya no es la que el diseñador tenía delante.
                throw new TableChangeFailedException(
                    Explain(Normalize(error), sql, alteration),
                    sql,
                    applied,
                    reverted: scope is not null);
            }

            applied.Add(sql);
        }

        // **Dentro de la transacción y antes de confirmar**, que es el único
        // momento en que una comprobación puede impedir algo: después ya está
        // hecho, y antes todavía no hay nada que mirar.
        await VerifyChangeAsync(session, alteration, scope?.Transaction, cancellationToken);

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
