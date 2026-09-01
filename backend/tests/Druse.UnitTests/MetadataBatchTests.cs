using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.UnitTests;

/// <summary>
/// El reparto de una lectura que abarcó varias tablas.
///
/// No hace falta servidor: lo que se comprueba aquí es lo que los cuatro
/// proveedores comparten después de consultar, que es justo donde una lectura en
/// lote se rompe —lo de una tabla acaba colgando de otra— sin que ninguna
/// consulta haya fallado.
/// </summary>
public sealed class MetadataBatchTests
{
    private static DatabaseObject Table(string name, string? schema = "public") => new()
    {
        Id = $"{schema}.{name}",
        Name = name,
        Kind = DatabaseObjectKind.Table,
        Database = "druse",
        Schema = schema,
    };

    private static DatabaseColumn Column(string name, int ordinal = 1) => new()
    {
        Name = name,
        DataType = "integer",
        IsNullable = false,
        Ordinal = ordinal,
    };

    private static TableRef Key(DatabaseObject table) => new(table.Schema ?? "public", table.Name);

    [Fact]
    public void GroupByTable_RepartePorLaTablaDeCadaFila()
    {
        var factura = new TableRef("ventas", "factura");
        var cliente = new TableRef("ventas", "cliente");

        var grouped = MetadataBatch.GroupByTable(
        [
            (factura, "ix_factura_fecha"),
            (cliente, "ix_cliente_nit"),
            (factura, "ix_factura_cliente"),
        ]);

        Assert.Equal(["ix_factura_fecha", "ix_factura_cliente"], grouped[factura]);
        Assert.Equal(["ix_cliente_nit"], grouped[cliente]);
    }

    /// <summary>
    /// Dos tablas del mismo nombre en esquemas distintos son dos tablas.
    ///
    /// Es el caso que convierte una lectura conjunta en un desastre silencioso:
    /// `ventas.factura` y `compras.factura` existen a la vez en muchas bases, y
    /// agrupar solo por nombre les mezclaría las claves.
    /// </summary>
    [Fact]
    public void GroupByTable_NoMezclaElMismoNombreEnDosEsquemas()
    {
        var ventas = new TableRef("ventas", "factura");
        var compras = new TableRef("compras", "factura");

        var grouped = MetadataBatch.GroupByTable([(ventas, "a"), (compras, "b")]);

        Assert.Equal(["a"], grouped[ventas]);
        Assert.Equal(["b"], grouped[compras]);
    }

    /// <summary>
    /// Una tabla sin filas no queda con una lista vacía: no queda.
    ///
    /// Distinguir «no tiene índices» de «no se preguntó por ella» es lo que
    /// después permite decir cuál desapareció del catálogo.
    /// </summary>
    [Fact]
    public void GroupByTable_LaTablaSinFilasNoAparece()
    {
        var grouped = MetadataBatch.GroupByTable<string>([]);

        Assert.Empty(grouped);
    }

    [Fact]
    public void Unique_QuitaLasTablasPedidasDosVeces()
    {
        var wanted = MetadataBatch.Unique(
            [Table("factura"), Table("cliente"), Table("factura")],
            Key);

        Assert.Equal(2, wanted.Count);
        Assert.Contains(new TableRef("public", "factura"), wanted);
        Assert.Contains(new TableRef("public", "cliente"), wanted);
    }

    [Fact]
    public void Compose_DevuelveLasTablasEnElOrdenEnQueSePidieron()
    {
        var tables = new[] { Table("cliente"), Table("factura") };

        var columns = new Dictionary<TableRef, IReadOnlyList<DatabaseColumn>>
        {
            [Key(tables[0])] = [Column("id")],
            [Key(tables[1])] = [Column("id"), Column("cliente_id", 2)],
        };

        var composed = MetadataBatch.Compose(
            tables,
            Key,
            columns,
            new Dictionary<TableRef, TableStructure>());

        Assert.Equal(["cliente", "factura"], composed.Select(detail => detail.Table.Name));
        Assert.Equal(2, composed[1].Columns.Count);
    }

    /// <summary>
    /// La tabla que ya no está en el catálogo no se devuelve, y no tumba a las
    /// demás.
    ///
    /// No hay tablas sin columnas: una que no trae ninguna es una que alguien
    /// borró entre que se pidió el diagrama y se leyó.
    /// </summary>
    [Fact]
    public void Compose_OmiteLaTablaQueYaNoEsta()
    {
        var tables = new[] { Table("cliente"), Table("borrada") };

        var columns = new Dictionary<TableRef, IReadOnlyList<DatabaseColumn>>
        {
            [Key(tables[0])] = [Column("id")],
        };

        var composed = MetadataBatch.Compose(
            tables,
            Key,
            columns,
            new Dictionary<TableRef, TableStructure>());

        Assert.Equal(["cliente"], composed.Select(detail => detail.Table.Name));
    }

    /// <summary>
    /// Una tabla con columnas pero sin restricciones sale con una estructura
    /// vacía, no desaparece.
    /// </summary>
    [Fact]
    public void Compose_LaTablaSinRestriccionesSaleConEstructuraVacia()
    {
        var tables = new[] { Table("bitacora") };

        var columns = new Dictionary<TableRef, IReadOnlyList<DatabaseColumn>>
        {
            [Key(tables[0])] = [Column("id")],
        };

        var detail = Assert.Single(MetadataBatch.Compose(
            tables,
            Key,
            columns,
            new Dictionary<TableRef, TableStructure>()));

        Assert.Null(detail.Structure.PrimaryKey);
        Assert.Empty(detail.Structure.ForeignKeys);
        Assert.Empty(detail.Structure.Indexes);
    }

    /// <summary>El detalle conserva el nodo que se pidió, con su identificador.</summary>
    [Fact]
    public void Compose_ConservaElNodoDelExplorador()
    {
        var table = Table("factura", "ventas");

        var columns = new Dictionary<TableRef, IReadOnlyList<DatabaseColumn>>
        {
            [Key(table)] = [Column("id")],
        };

        var detail = Assert.Single(MetadataBatch.Compose(
            [table],
            Key,
            columns,
            new Dictionary<TableRef, TableStructure>()));

        Assert.Same(table, detail.Table);
        Assert.Equal("ventas.factura", detail.Table.Id);
    }
}
