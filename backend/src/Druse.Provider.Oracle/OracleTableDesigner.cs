using System.Data.Common;
using System.Globalization;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Provider.Oracle;

/// <summary>DDL de Oracle. Solo aporta su dialecto.</summary>
public sealed class OracleTableDesigner : TableDesignerBase
{
    public override DatabaseEngine Engine => DatabaseEngine.Oracle;

    public override IReadOnlyList<string> CommonDataTypes =>
    [
        "NUMBER", "NUMBER(10)", "NUMBER(19)", "NUMBER(18,2)", "BINARY_DOUBLE", "FLOAT",
        "VARCHAR2(50)", "VARCHAR2(255)", "VARCHAR2(4000)", "CLOB", "CHAR(10)", "NVARCHAR2(255)",
        "DATE", "TIMESTAMP", "TIMESTAMP WITH TIME ZONE", "INTERVAL DAY TO SECOND",
        "RAW(16)", "BLOB",
    ];

    /// <summary>
    /// Oracle no tiene el tipo que en los demás motores se da por hecho.
    ///
    /// **No hay booleano** como tipo de columna hasta 23ai, y la inmensa mayoría
    /// de las instalaciones no lo son: un booleano aterriza en `NUMBER(1)` y se
    /// lee como 1 y 0. Tampoco hay identificador único —`RAW(16)` guarda los
    /// dieciséis bytes pero el motor no comprueba que sean uno— así que se
    /// prefiere guardarlo escrito, que es lo que se puede volver a leer.
    ///
    /// **Su hora sin fecha tampoco existe.** `DATE` siempre lleva las dos, y no
    /// hay un `TIME` suelto: una columna de horas se guarda como intervalo, que
    /// es lo único que representa «cuánto» sin decir «cuándo».
    ///
    /// El tope de `VARCHAR2` son 4 000 bytes salvo que el administrador haya
    /// encendido los extendidos, así que lo que pase de ahí va a `CLOB`.
    /// </summary>
    public override string TypeFor(TypeFacets facets) => facets.Family switch
    {
        // 36 caracteres es su forma escrita, y así se sigue leyendo igual que en
        // el origen.
        ColumnFamily.Uuid => "VARCHAR2(36)",
        ColumnFamily.Boolean => "NUMBER(1)",
        ColumnFamily.Integral => "NUMBER(19)",
        ColumnFamily.Fractional => facets.Precision is { } precision
            ? $"NUMBER({precision},{facets.Scale ?? 0})"
            : "BINARY_DOUBLE",
        ColumnFamily.Date => "DATE",
        ColumnFamily.Time => "INTERVAL DAY(0) TO SECOND(6)",
        ColumnFamily.Timestamp => "TIMESTAMP(6)",
        ColumnFamily.TimestampWithZone => "TIMESTAMP(6) WITH TIME ZONE",
        ColumnFamily.Binary => facets.IsUnbounded || facets.Length is null
            ? "BLOB"
            : $"RAW({facets.Length})",
        // No hay tipo JSON antes de 21c, y el que hay no está en las versiones
        // que la gente tiene: el JSON llega como texto y deja de comprobarse.
        _ when facets.IsUnbounded || facets.Length is null || facets.Length > 4000 => "CLOB",
        _ => $"VARCHAR2({facets.Length})",
    };

    /// <summary>
    /// Oracle no tiene columnas incluidas ni índices parciales con esta forma de
    /// instrucción, pero sí estructuras que los demás no: `BITMAP` para columnas
    /// de poca variedad, que es de las pocas cosas en las que no tiene rival.
    ///
    /// El índice parcial se consigue de otra manera —indexando una expresión que
    /// devuelve nulo fuera del filtro— y ofrecerlo como si fuera un `WHERE`
    /// prometería algo que la instrucción no dice.
    /// </summary>
    public override IndexCapabilities IndexCapabilities => new()
    {
        SupportsIncludedColumns = false,
        SupportsFilter = false,
        SupportsSortDirection = true,
        Methods = ["btree", "bitmap"],
    };

    /// <summary>
    /// Un respaldo se lee con lecturas repetibles, que en Oracle **no bloquean a
    /// nadie**.
    ///
    /// Es su modelo de siempre: quien lee no espera a quien escribe, y una
    /// transacción de solo lectura ve la base como estaba al empezar. Lo que en
    /// SQL Server hay que pedir aparte y encender en la base, aquí sale de fábrica.
    /// </summary>
    public override ScripterCapabilities Capabilities { get; } = new()
    {
        Isolation = BackupIsolation.Serializable,
    };

    /// <summary>
    /// El punto y coma no viaja por el cable, aunque sí se escribe en el guion.
    /// El porqué está en <see cref="OracleStatement"/>.
    /// </summary>
    protected override string ToCommand(string statement) => OracleStatement.Prepare(statement);

    /// <summary>Aquí el límite va al final, pero con la forma del estándar.</summary>
    protected override string RowLimitPrefix(int maxRows) => string.Empty;

    protected override string RowLimitSuffix(int maxRows) =>
        $"FETCH FIRST {maxRows.ToString(CultureInfo.InvariantCulture)} ROWS ONLY";

    /// <summary>No hay booleano: se escribe con uno y cero.</summary>
    protected override string BooleanLiteral(bool value) => value ? "1" : "0";

    /// <summary>
    /// El binario se escribe como un literal hexadecimal citado.
    ///
    /// `HEXTORAW('')` sería un error, así que una tira vacía se escribe como
    /// nula: en Oracle **la cadena vacía y el nulo son la misma cosa**, y eso vale
    /// también para los binarios.
    /// </summary>
    protected override string BinaryLiteral(byte[] value)
    {
        ArgumentNullException.ThrowIfNull(value);

        return value.Length == 0 ? "NULL" : $"HEXTORAW('{Convert.ToHexString(value)}')";
    }

    /// <summary>
    /// Solo se cita lo que lo necesita: el porqué está en
    /// <see cref="OracleIdentifier"/>.
    /// </summary>
    protected override string Quote(string identifier) => OracleIdentifier.Quote(identifier);

    /// <summary>El mismo normalizador que usan las consultas de este motor.</summary>
    protected override QueryError Normalize(Exception exception) =>
        OracleErrorNormalizer.Normalize(exception);

    protected override DbConnection Connection(IDatabaseSession session) =>
        session is OracleSession oracle
            ? oracle.Connection
            : throw new ArgumentException(
                "La sesión no pertenece al proveedor Oracle.",
                nameof(session));

    /// <summary>
    /// **El DDL de Oracle confirma solo.**
    ///
    /// Cada `CREATE` o `ALTER` lleva un commit implícito delante y otro detrás, así
    /// que si la tercera instrucción de un cambio falla, las dos primeras ya
    /// están hechas y no hay vuelta atrás. Envolverlo en una transacción daría una
    /// falsa sensación de seguridad; es mejor decirlo.
    /// </summary>
    public override bool SupportsTransactionalDdl => false;

    /// <summary>
    /// La identidad de Oracle desde 12c. Antes había que montar una secuencia y
    /// un disparador a mano, y eso ya no se escribe en una tabla nueva.
    /// </summary>
    protected override string IdentityClause(TableColumnDefinition column) =>
        "GENERATED BY DEFAULT AS IDENTITY";

    /// <summary>
    /// `MODIFY` cambia lo que se le diga y **deja quieto lo que no se nombre**, al
    /// revés que el `MODIFY` de MySQL.
    ///
    /// Tiene una trampa que hay que rodear: repetir la nulabilidad que la columna
    /// ya tiene es un error —`ORA-01442: la columna ya permite valores nulos`— y
    /// no un no-op. Como aquí no se sabe cómo estaba antes, se escribe en dos
    /// instrucciones: el tipo por un lado, que siempre se puede repetir, y el
    /// resto por otro.
    /// </summary>
    protected override IReadOnlyList<string> AlterColumn(
        string qualifiedTable,
        ColumnAlteration change)
    {
        ArgumentNullException.ThrowIfNull(change);

        var statements = new List<string>();
        var column = change.Column;

        if (change.IsRename)
        {
            statements.Add(
                $"ALTER TABLE {qualifiedTable} RENAME COLUMN {Quote(change.CurrentName)} " +
                $"TO {Quote(column.Name)};");
        }

        statements.Add(
            $"ALTER TABLE {qualifiedTable} MODIFY ({Quote(column.Name)} {column.DataType.Trim()});");

        if (!string.IsNullOrWhiteSpace(column.DefaultValue))
        {
            statements.Add(
                $"ALTER TABLE {qualifiedTable} MODIFY ({Quote(column.Name)} " +
                $"DEFAULT {column.DefaultValue.Trim()});");
        }

        return statements;
    }

    protected override string RenameTable(
        string qualifiedTable,
        DatabaseObject table,
        string newName) =>
        $"ALTER TABLE {qualifiedTable} RENAME TO {Quote(newName)};";

    /// <summary>
    /// Aquí el índice tiene nombre propio dentro del esquema y **no se nombra la
    /// tabla** al borrarlo, al revés que en MySQL y SQL Server.
    /// </summary>
    protected override string DropIndex(
        string qualifiedTable,
        DatabaseObject table,
        string indexName)
    {
        ArgumentNullException.ThrowIfNull(table);

        return table.Schema is null
            ? $"DROP INDEX {Quote(indexName)};"
            : $"DROP INDEX {Quote(table.Schema)}.{Quote(indexName)};";
    }

    /// <summary>
    /// `BITMAP` no es un `USING`: es la clase del índice y va delante, donde en
    /// otros motores iría `UNIQUE`.
    /// </summary>
    protected override string IndexKind(IndexDefinition index)
    {
        ArgumentNullException.ThrowIfNull(index);

        return index.Method?.ToLowerInvariant() == "bitmap"
            ? "BITMAP "
            : index.IsUnique ? "UNIQUE " : string.Empty;
    }

    /// <summary>Oracle no admite `USING`: la estructura ya se dijo delante.</summary>
    protected override string IndexMethodClause(IndexDefinition index) => string.Empty;

    protected override string IndexSuffix(IndexDefinition index) => string.Empty;

    /// <summary>
    /// Al soltar una clave primaria o una restricción de unicidad hay que decir
    /// además qué se hace con el índice que la sostiene.
    ///
    /// Sin `DROP INDEX`, Oracle deja el índice huérfano en pie y el siguiente
    /// intento de crear la restricción falla porque el nombre ya está cogido.
    /// </summary>
    protected override string DropConstraint(
        string qualifiedTable,
        string name,
        ConstraintKind kind) => kind switch
        {
            ConstraintKind.PrimaryKey =>
                $"ALTER TABLE {qualifiedTable} DROP PRIMARY KEY DROP INDEX;",
            ConstraintKind.Unique =>
                $"ALTER TABLE {qualifiedTable} DROP CONSTRAINT {Quote(name)} DROP INDEX;",
            _ => $"ALTER TABLE {qualifiedTable} DROP CONSTRAINT {Quote(name)};",
        };

    /// <summary>
    /// En Oracle el esquema es el dueño y no hay un nivel de base por encima.
    ///
    /// El explorador enseña los esquemas en el sitio de las bases, así que aquí
    /// llegan los dos con el mismo valor: escribir `DRUSE.DRUSE.CLIENTES` sería un
    /// nombre inválido.
    /// </summary>
    protected override string Qualify(string? database, string? schema, string name)
    {
        var owner = !string.IsNullOrWhiteSpace(schema) ? schema : database;

        return string.IsNullOrWhiteSpace(owner)
            ? Quote(name)
            : $"{Quote(owner)}.{Quote(name)}";
    }

    /// <summary>
    /// Crear un esquema en Oracle es crear un usuario, y eso pide permisos de
    /// administrador y decisiones que un respaldo no puede tomar: qué contraseña,
    /// qué cuota, en qué espacio de tablas.
    ///
    /// Así que no se guioniza. Restaurar en un esquema que no existe falla al
    /// crear la primera tabla, con el error del motor, en lugar de hacerlo con un
    /// `CREATE USER` inventado.
    /// </summary>
    public override IReadOnlyList<string> ScriptSchema(string schema) => [];
}
