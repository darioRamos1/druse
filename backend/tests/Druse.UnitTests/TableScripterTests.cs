using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Informix;
using Druse.Provider.MySql;
using Druse.Provider.PostgreSql;
using Druse.Provider.SqlServer;

namespace Druse.UnitTests;

/// <summary>
/// El DDL con el que se reproduce una tabla que ya existe.
///
/// Aquí se comprueba lo que no necesita un servidor: **qué se escribe y en qué
/// orden se reparte**. Que lo escrito se pueda ejecutar y devuelva la misma tabla
/// lo comprueba la prueba contractual, contra los cuatro motores; comprobarlo solo
/// aquí sería comprobar que el generador no ha cambiado, no que el respaldo sirva.
/// </summary>
public sealed class TableScripterTests
{
    private static DatabaseObject Table => new()
    {
        Id = "ventas.pedidos",
        Name = "pedidos",
        Kind = DatabaseObjectKind.Table,
        Database = "tienda",
        Schema = "ventas",
    };

    /// <summary>
    /// Una tabla con todo lo que se guioniza: identidad, valor por omisión,
    /// clave primaria con nombre, unicidad, comprobación, un índice suelto, el
    /// índice que sostiene la clave y una clave foránea.
    /// </summary>
    private static ScriptedTable Pedidos() => new()
    {
        Table = Table,
        Columns =
        [
            new DatabaseColumn
            {
                Name = "id",
                DataType = "BIGINT",
                IsNullable = false,
                IsPrimaryKey = true,
                IsGenerated = true,

                // Lo que PostgreSQL devuelve para una columna `bigserial`. No debe
                // aparecer en el guion: la identidad ya la genera.
                DefaultValue = "nextval('pedidos_id_seq'::regclass)",
                Ordinal = 1,
            },
            new DatabaseColumn
            {
                Name = "codigo",
                DataType = "VARCHAR(20)",
                IsNullable = false,
                Ordinal = 2,
            },
            new DatabaseColumn
            {
                Name = "total",
                DataType = "DECIMAL(12,2)",
                IsNullable = false,
                DefaultValue = "0",
                Ordinal = 3,
            },
            new DatabaseColumn
            {
                Name = "cliente_id",
                DataType = "BIGINT",
                IsNullable = true,
                Ordinal = 4,
            },
        ],
        Structure = new TableStructure
        {
            PrimaryKey = new DatabasePrimaryKey { Name = "pk_pedidos", Columns = ["id"] },
            UniqueConstraints =
            [
                new DatabaseUniqueConstraint { Name = "uq_pedidos_codigo", Columns = ["codigo"] },
            ],
            CheckConstraints =
            [
                new DatabaseCheckConstraint { Name = "ck_pedidos_total", Expression = "total >= 0" },
            ],
            Indexes =
            [
                new DatabaseIndex
                {
                    Name = "ix_pedidos_cliente",
                    Columns = [new IndexColumn { Name = "cliente_id" }],
                },
                new DatabaseIndex
                {
                    Name = "pk_pedidos",
                    Columns = [new IndexColumn { Name = "id" }],
                    IsUnique = true,
                    IsPrimaryKey = true,
                    IsConstraintIndex = true,
                },
                new DatabaseIndex
                {
                    Name = "uq_pedidos_codigo",
                    Columns = [new IndexColumn { Name = "codigo" }],
                    IsUnique = true,
                    IsConstraintIndex = true,
                },
            ],
            ForeignKeys =
            [
                new DatabaseForeignKey
                {
                    Name = "fk_pedidos_cliente",
                    Columns = ["cliente_id"],
                    ReferencedSchema = "ventas",
                    ReferencedTable = "clientes",
                    ReferencedColumns = ["id"],
                    OnDelete = ForeignKeyAction.Cascade,
                },
            ],
        },
    };

    private static string Script(IReadOnlyList<string> statements) =>
        string.Join("\n", statements);

    [Fact]
    public void LaTablaSeEscribeSinIndicesYSinClavesForaneas()
    {
        var scripter = new PostgreSqlTableDesigner();
        var table = Pedidos();

        // Una sola instrucción: si el `CREATE TABLE` arrastrase los índices, se
        // crearían antes de cargar los datos y cada fila insertada pagaría su
        // mantenimiento.
        var sql = Assert.Single(scripter.ScriptTable(table));

        Assert.Contains("CREATE TABLE \"ventas\".\"pedidos\"", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("CREATE INDEX", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("FOREIGN KEY", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void LaClavePrimariaConservaSuNombreDondeElMotorLoRespeta()
    {
        var table = Pedidos();

        Assert.Contains(
            "CONSTRAINT \"pk_pedidos\" PRIMARY KEY (\"id\")",
            Script(new PostgreSqlTableDesigner().ScriptTable(table)),
            StringComparison.Ordinal);

        Assert.Contains(
            "CONSTRAINT [pk_pedidos] PRIMARY KEY ([id])",
            Script(new SqlServerTableDesigner().ScriptTable(table)),
            StringComparison.Ordinal);
    }

    /// <summary>
    /// Informix no reproduce el nombre de la clave primaria ni el de la unicidad,
    /// y no es una omisión: lo que Druse lee de su catálogo es el nombre del
    /// **índice** que las sostiene —` 108_26`, con un espacio delante y distinto en
    /// cada creación—, que el propio motor rechaza al crearlo.
    ///
    /// Cuando el nombre no viaja, la restricción se escribe sin él y lo pone el
    /// motor. Se comprueba junto a la forma de Informix —el nombre detrás del
    /// cuerpo— porque son la misma línea del guion.
    /// </summary>
    [Fact]
    public void InformixEscribeLasRestriccionesSinNombreYElRestoDetras()
    {
        var designer = new InformixTableDesigner();

        var sql = Script(designer.ScriptTable(Pedidos()));

        Assert.False(designer.Capabilities.NamesPrimaryKey);
        Assert.False(designer.Capabilities.NamesUniqueConstraints);

        Assert.Contains("PRIMARY KEY (\"id\")", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("CONSTRAINT \"pk_pedidos\"", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("CONSTRAINT \"uq_pedidos_codigo\"", sql, StringComparison.Ordinal);

        // El nombre que sí viaja —el de la comprobación, que aquí no lo pone un
        // índice— va detrás del cuerpo, que es como lo escribe Informix.
        Assert.Contains(
            "CHECK (total >= 0) CONSTRAINT \"ck_pedidos_total\"",
            sql,
            StringComparison.Ordinal);
    }

    /// <summary>
    /// En MySQL toda clave primaria se llama `PRIMARY`, así que escribir un nombre
    /// sería prometer algo que el motor descarta en silencio.
    /// </summary>
    [Fact]
    public void MySqlNoEscribeElNombreDeLaClavePrimaria()
    {
        var designer = new MySqlTableDesigner();

        var sql = Script(designer.ScriptTable(Pedidos()));

        Assert.False(designer.Capabilities.NamesPrimaryKey);
        Assert.Contains("PRIMARY KEY (`id`)", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("CONSTRAINT `pk_pedidos`", sql, StringComparison.Ordinal);
    }

    /// <summary>
    /// La secuencia que PostgreSQL pone como valor por omisión de una columna
    /// `bigserial` no se copia: la identidad ya genera el valor, y escribir las dos
    /// cosas deja la tabla con dos generadores o hace que el motor la rechace.
    /// </summary>
    [Fact]
    public void UnaColumnaQueGeneraSuValorNoArrastraElValorPorOmision()
    {
        var sql = Script(new PostgreSqlTableDesigner().ScriptTable(Pedidos()));

        Assert.Contains("GENERATED BY DEFAULT AS IDENTITY", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("nextval", sql, StringComparison.Ordinal);

        // El de una columna normal sí se conserva.
        Assert.Contains("DEFAULT 0", sql, StringComparison.Ordinal);
    }

    [Fact]
    public void LasRestriccionesDeLaTablaEntranEnElCreate()
    {
        var sql = Script(new PostgreSqlTableDesigner().ScriptTable(Pedidos()));

        Assert.Contains("CONSTRAINT \"uq_pedidos_codigo\" UNIQUE", sql, StringComparison.Ordinal);
        Assert.Contains("CONSTRAINT \"ck_pedidos_total\" CHECK", sql, StringComparison.Ordinal);
    }

    /// <summary>
    /// El índice que sostiene una restricción ya se creó con ella. Volver a
    /// escribirlo suelto lo rechazan los cuatro motores por nombre repetido, así
    /// que la prueba mira que salga **uno solo** de los tres que trae la tabla.
    /// </summary>
    [Fact]
    public void LosIndicesDeUnaRestriccionNoSeVuelvenAEscribir()
    {
        var sql = Assert.Single(new PostgreSqlTableDesigner().ScriptIndexes(Pedidos()));

        Assert.Contains("CREATE INDEX \"ix_pedidos_cliente\"", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("pk_pedidos", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("uq_pedidos_codigo", sql, StringComparison.Ordinal);
    }

    /// <summary>
    /// Las claves foráneas van aparte y como `ALTER TABLE`: entre dos tablas puede
    /// haber un ciclo, y entonces no existe ningún orden de creación que las
    /// satisfaga a la vez.
    /// </summary>
    [Fact]
    public void LasClavesForaneasSalenComoAlterYConservanSuAccion()
    {
        var sql = Assert.Single(new PostgreSqlTableDesigner().ScriptForeignKeys(Pedidos()));

        Assert.StartsWith("ALTER TABLE \"ventas\".\"pedidos\" ADD", sql, StringComparison.Ordinal);
        Assert.Contains("CONSTRAINT \"fk_pedidos_cliente\" FOREIGN KEY", sql, StringComparison.Ordinal);
        Assert.Contains("REFERENCES \"ventas\".\"clientes\" (\"id\")", sql, StringComparison.Ordinal);
        Assert.Contains("ON DELETE CASCADE", sql, StringComparison.Ordinal);
    }

    /// <summary>
    /// En MySQL el esquema **es** la base: calificar con dos niveles daría un
    /// nombre inválido, y por eso el motor lo declara en vez de que lo suponga
    /// quien arma el respaldo.
    /// </summary>
    [Fact]
    public void MySqlCalificaConUnSoloNivel()
    {
        var designer = new MySqlTableDesigner();

        var sql = Script(designer.ScriptTable(Pedidos()));

        Assert.False(designer.Capabilities.SupportsSchemas);
        Assert.Contains("CREATE TABLE `ventas`.`pedidos`", sql, StringComparison.Ordinal);
        Assert.DoesNotContain("`tienda`.`ventas`", sql, StringComparison.Ordinal);
    }

    /// <summary>
    /// Los cuatro motores reparten el mismo trabajo en las mismas tres piezas.
    /// Si alguno dejara de escribir una, el respaldo saldría incompleto sin que
    /// nada fallara.
    /// </summary>
    [Theory]
    [MemberData(nameof(Scripters))]
    public void TodosLosMotoresEscribenLasTresPartes(IDatabaseScripter scripter)
    {
        ArgumentNullException.ThrowIfNull(scripter);

        var table = Pedidos();

        Assert.Single(scripter.ScriptTable(table));
        Assert.Single(scripter.ScriptIndexes(table));
        Assert.Single(scripter.ScriptForeignKeys(table));
    }

    /// <summary>
    /// Un nombre con el cierre del identificador dentro no escapa del guion.
    ///
    /// Vale la pena comprobarlo aquí y no solo en el diseñador: los nombres de un
    /// respaldo **vienen del catálogo**, no de un formulario, y quien pueda crear
    /// una tabla en la base de origen elige cómo se llama.
    /// </summary>
    [Fact]
    public void UnNombreConElCierreDelIdentificadorNoEscapa()
    {
        var table = Pedidos();
        var hostil = table with
        {
            Table = Table with { Name = "pedidos\"; DROP TABLE clientes; --" },
        };

        var sql = Script(new PostgreSqlTableDesigner().ScriptTable(hostil));

        Assert.Contains(
            "\"pedidos\"\"; DROP TABLE clientes; --\"",
            sql,
            StringComparison.Ordinal);
    }

    public static TheoryData<IDatabaseScripter> Scripters() =>
    [
        new PostgreSqlTableDesigner(),
        new SqlServerTableDesigner(),
        new MySqlTableDesigner(),
        new InformixTableDesigner(),
    ];
}
