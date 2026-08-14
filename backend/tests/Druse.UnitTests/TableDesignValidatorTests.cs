using Druse.Application.Tables;
using Druse.Domain;

namespace Druse.UnitTests;

/// <summary>
/// Lo que se rechaza antes de escribir una sola instrucción.
///
/// Detectar aquí una clave foránea descompensada ahorra al usuario leer un error
/// del motor sobre una sintaxis que él no escribió. Lo que el motor no admite se
/// rechaza en vez de ignorarse: un índice que se crea callando una opción que se
/// pidió es peor que uno que no se crea.
/// </summary>
public sealed class TableDesignValidatorTests
{
    private static DatabaseObject Tabla() => new()
    {
        Id = "t1",
        Name = "pedidos",
        Kind = DatabaseObjectKind.Table,
        Schema = "ventas",
    };

    private static IndexCapabilities SinExtras() => new()
    {
        SupportsIncludedColumns = false,
        SupportsFilter = false,
        Methods = ["btree"],
    };

    [Fact]
    public void UnIndiceSinColumnasNoEsValido()
    {
        var alteration = new TableAlteration
        {
            Table = Tabla(),
            AddedIndexes = [new IndexDefinition { Name = "ix_vacio", Columns = [] }],
        };

        var result = TableDesignValidator.Validate(alteration);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("al menos una columna", StringComparison.Ordinal));
    }

    [Fact]
    public void UnIndiceQueRepiteUnaColumnaNoEsValido()
    {
        var alteration = new TableAlteration
        {
            Table = Tabla(),
            AddedIndexes =
            [
                new IndexDefinition
                {
                    Name = "ix_pedidos_cliente",
                    Columns =
                    [
                        new IndexColumn { Name = "cliente_id" },
                        new IndexColumn { Name = "cliente_id" },
                    ],
                },
            ],
        };

        var result = TableDesignValidator.Validate(alteration);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("repite columnas", StringComparison.Ordinal));
    }

    /// <summary>
    /// Las dos listas emparejan por posición, así que distinta longitud no es un
    /// descuido: es una clave que el motor rechazaría sin decir cuál sobra.
    /// </summary>
    [Fact]
    public void UnaClaveForaneaDescompensadaNoEsValida()
    {
        var alteration = new TableAlteration
        {
            Table = Tabla(),
            AddedForeignKeys =
            [
                new ForeignKeyDefinition
                {
                    Name = "fk_pedidos_cliente",
                    Columns = ["cliente_id", "sucursal_id"],
                    ReferencedTable = "clientes",
                    ReferencedColumns = ["id"],
                },
            ],
        };

        var result = TableDesignValidator.Validate(alteration);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("empareja 2 columnas con 1", StringComparison.Ordinal));
    }

    [Fact]
    public void LoQueElMotorNoAdmiteSeRechazaEnVezDeIgnorarse()
    {
        var alteration = new TableAlteration
        {
            Table = Tabla(),
            AddedIndexes =
            [
                new IndexDefinition
                {
                    Name = "ix_pedidos_cliente",
                    Columns = [new IndexColumn { Name = "cliente_id" }],
                    IncludedColumns = ["total"],
                    Filter = "estado = 'activo'",
                    Method = "gin",
                },
            ],
        };

        var result = TableDesignValidator.Validate(alteration, SinExtras());

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("columnas incluidas", StringComparison.Ordinal));
        Assert.Contains(result.Errors, error => error.Contains("índices parciales", StringComparison.Ordinal));
        Assert.Contains(result.Errors, error => error.Contains("'gin'", StringComparison.Ordinal));
    }

    [Fact]
    public void LaClavePrimariaNoPuedeApoyarseEnUnaColumnaQueSeBorra()
    {
        var alteration = new TableAlteration
        {
            Table = Tabla(),
            DroppedColumns = ["codigo"],
            NewPrimaryKey = new PrimaryKeyDefinition { Columns = ["codigo"] },
        };

        var result = TableDesignValidator.Validate(alteration);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("que se borran", StringComparison.Ordinal));
    }

    /// <summary>
    /// Al crear la tabla sí se conocen todas las columnas, así que un índice que
    /// nombra una que no existe se puede rechazar sin preguntar al motor.
    /// </summary>
    [Fact]
    public void AlCrearSeComprobandoQueLasColumnasExistan()
    {
        var table = new TableDefinition
        {
            Name = "pedidos",
            Columns = [new TableColumnDefinition { Name = "id", DataType = "INT" }],
            Indexes =
            [
                new IndexDefinition
                {
                    Name = "ix_pedidos_cliente",
                    Columns = [new IndexColumn { Name = "cliente_id" }],
                },
            ],
        };

        var result = TableDesignValidator.Validate(table);

        Assert.False(result.IsValid);
        Assert.Contains(result.Errors, error => error.Contains("columnas que la tabla no tiene", StringComparison.Ordinal));
    }

    [Fact]
    public void UnDisenoCompletoEsValido()
    {
        var table = new TableDefinition
        {
            Name = "pedidos",
            Columns =
            [
                new TableColumnDefinition { Name = "id", DataType = "INT", IsNullable = false, IsPrimaryKey = true },
                new TableColumnDefinition { Name = "cliente_id", DataType = "INT" },
                new TableColumnDefinition { Name = "total", DataType = "DECIMAL(12,2)" },
            ],
            Indexes =
            [
                new IndexDefinition
                {
                    Name = "ix_pedidos_cliente",
                    Columns = [new IndexColumn { Name = "cliente_id" }],
                },
            ],
            UniqueConstraints =
            [
                new UniqueConstraintDefinition { Name = "uq_pedidos_cliente", Columns = ["cliente_id"] },
            ],
            CheckConstraints =
            [
                new CheckConstraintDefinition { Name = "ck_pedidos_total", Expression = "total > 0" },
            ],
            ForeignKeys =
            [
                new ForeignKeyDefinition
                {
                    Name = "fk_pedidos_cliente",
                    Columns = ["cliente_id"],
                    ReferencedTable = "clientes",
                    ReferencedColumns = ["id"],
                },
            ],
        };

        Assert.True(TableDesignValidator.Validate(table, SinExtras()).IsValid);
    }
}
