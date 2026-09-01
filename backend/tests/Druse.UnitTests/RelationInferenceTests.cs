using Druse.Application.Diagrams;
using Druse.Domain;

namespace Druse.UnitTests;

/// <summary>
/// Las relaciones que Druse supone por el nombre.
///
/// La mitad de estas pruebas comprueban que **no** sugiere: es donde esto se
/// rompe. Una inferencia entusiasta llena el diagrama de líneas falsas, y una
/// línea falsa es peor que ninguna, porque el usuario no tiene cómo saber que lo
/// es.
/// </summary>
public sealed class RelationInferenceTests
{
    private static DatabaseColumn Column(string name, string type = "int8", bool pk = false) => new()
    {
        Name = name,
        DataType = type,
        IsNullable = !pk,
        IsPrimaryKey = pk,
        Ordinal = 1,
    };

    private static TableDetail Table(
        string name,
        DatabaseColumn[] columns,
        string[]? primary = null,
        DatabaseForeignKey[]? foreignKeys = null) => new()
    {
        Table = new DatabaseObject
        {
            Id = $"ventas.{name}",
            Name = name,
            Kind = DatabaseObjectKind.Table,
            Database = "druse",
            Schema = "ventas",
        },
        Columns = columns,
        Structure = new TableStructure
        {
            PrimaryKey = primary is null
                ? null
                : new DatabasePrimaryKey { Name = $"pk_{name}", Columns = primary },
            ForeignKeys = foreignKeys ?? [],
        },
    };

    [Fact]
    public void SugiereLaColumnaQueNombraAOtraTabla()
    {
        var tables = new[]
        {
            Table("cliente", [Column("id", pk: true), Column("nombre", "varchar")], ["id"]),
            Table("pedido", [Column("id", pk: true), Column("cliente_id")], ["id"]),
        };

        var suggestion = Assert.Single(RelationInference.Suggest(tables));

        Assert.Equal("cliente_id", suggestion.Column);
        Assert.Equal("pedido", suggestion.From.Name);
        Assert.Equal("cliente", suggestion.To.Name);
        Assert.Equal("id", suggestion.ReferencedColumn);
        Assert.Equal(SuggestionConfidence.High, suggestion.Confidence);
        Assert.Contains("cliente", suggestion.Reason, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("id_cliente")]
    [InlineData("clienteid")]
    public void ReconoceLasOtrasFormasDeNombrarla(string column)
    {
        var tables = new[]
        {
            Table("cliente", [Column("id", pk: true)], ["id"]),
            Table("pedido", [Column("id", pk: true), Column(column)], ["id"]),
        };

        Assert.Single(RelationInference.Suggest(tables));
    }

    [Fact]
    public void AdmiteElPluralEnLosDosIdiomas()
    {
        var tables = new[]
        {
            Table("clientes", [Column("id", pk: true)], ["id"]),
            Table("categories", [Column("id", pk: true)], ["id"]),
            Table("pedido", [Column("id", pk: true), Column("cliente_id"), Column("category_id")], ["id"]),
        };

        Assert.Equal(2, RelationInference.Suggest(tables).Count);
    }

    /// <summary>
    /// Lo que el motor ya garantiza no se supone: dibujarlo dos veces sería la
    /// misma relación con dos trazos distintos.
    /// </summary>
    [Fact]
    public void NoSugiereLoQueYaEsClaveForanea()
    {
        var tables = new[]
        {
            Table("cliente", [Column("id", pk: true)], ["id"]),
            Table(
                "pedido",
                [Column("id", pk: true), Column("cliente_id")],
                ["id"],
                [
                    new DatabaseForeignKey
                    {
                        Name = "fk_pedido_cliente",
                        Columns = ["cliente_id"],
                        ReferencedTable = "cliente",
                        ReferencedColumns = ["id"],
                    },
                ]),
        };

        Assert.Empty(RelationInference.Suggest(tables));
    }

    /// <summary>
    /// `estado`, `codigo` o `nombre` están en media base. Emparejarlas produciría
    /// un diagrama donde todo apunta a todo.
    /// </summary>
    [Theory]
    [InlineData("estado")]
    [InlineData("codigo")]
    [InlineData("nombre")]
    [InlineData("tipo")]
    [InlineData("fecha")]
    public void LosNombresGenericosNoSugierenNada(string column)
    {
        var tables = new[]
        {
            Table(column, [Column("id", pk: true)], ["id"]),
            Table("pedido", [Column("id", pk: true), Column(column)], ["id"]),
        };

        Assert.Empty(RelationInference.Suggest(tables));
    }

    /// <summary>
    /// Un `varchar` no apunta a un `bigint` por mucho que las columnas se llamen
    /// igual: la clave foránea no se podría crear.
    /// </summary>
    [Fact]
    public void ElTipoTieneQueEncajar()
    {
        var tables = new[]
        {
            Table("cliente", [Column("id", "bigint", pk: true)], ["id"]),
            Table("pedido", [Column("id", pk: true), Column("cliente_id", "varchar(10)")], ["id"]),
        };

        Assert.Empty(RelationInference.Suggest(tables));
    }

    /// <summary>
    /// Con dos candidatas, elegir sería inventar: `cliente` y `clientes` en la
    /// misma base pasa, y ninguna de las dos es más cierta que la otra.
    /// </summary>
    [Fact]
    public void ConDosCandidatasNoSugiereNinguna()
    {
        var tables = new[]
        {
            Table("cliente", [Column("id", pk: true)], ["id"]),
            Table("clientes", [Column("id", pk: true)], ["id"]),
            Table("pedido", [Column("id", pk: true), Column("cliente_id")], ["id"]),
        };

        Assert.Empty(RelationInference.Suggest(tables));
    }

    /// <summary>
    /// Sin clave primaria de una sola columna no hay a dónde apuntar: una
    /// compuesta necesitaría dos columnas en el origen, y adivinar cuáles es
    /// inventar.
    /// </summary>
    [Fact]
    public void NoApuntaATablaSinClavePrimariaSimple()
    {
        var tables = new[]
        {
            Table("cliente", [Column("id", pk: true), Column("region", pk: true)], ["id", "region"]),
            Table("pedido", [Column("id", pk: true), Column("cliente_id")], ["id"]),
        };

        Assert.Empty(RelationInference.Suggest(tables));
    }

    [Fact]
    public void NoSeSugiereASiMisma()
    {
        var tables = new[]
        {
            Table("pedido", [Column("id", pk: true), Column("pedido_id")], ["id"]),
        };

        Assert.Empty(RelationInference.Suggest(tables));
    }

    /// <summary>
    /// El nombre sin sufijo vale menos: se cuenta, pero no se dibuja salvo que
    /// se pidan las dudosas.
    /// </summary>
    [Fact]
    public void ElParecidoSinSufijoEsDeConfianzaBaja()
    {
        var tables = new[]
        {
            Table("sucursal", [Column("sucursal", "varchar(20)", pk: true)], ["sucursal"]),
            Table("venta", [Column("id", pk: true), Column("sucursal", "varchar(40)")], ["id"]),
        };

        var suggestion = Assert.Single(RelationInference.Suggest(tables));

        Assert.Equal(SuggestionConfidence.Low, suggestion.Confidence);
    }

    [Fact]
    public void UnaTablaSinNadaQueSuponerNoDaSugerencias()
    {
        var tables = new[]
        {
            Table("bitacora", [Column("id", pk: true), Column("mensaje", "text")], ["id"]),
        };

        Assert.Empty(RelationInference.Suggest(tables));
    }
}
