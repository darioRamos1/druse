using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Informix;
using Druse.Provider.MySql;
using Druse.Provider.PostgreSql;
using Druse.Provider.SqlServer;

namespace Druse.UnitTests;

/// <summary>
/// Los datos de un respaldo: cómo se escribe cada valor y qué filas entran.
///
/// Un literal mal escrito no da un error bonito: da un respaldo que se ejecuta a
/// medias, o peor, uno que se ejecuta entero y guarda otra cosa. Por eso esto se
/// comprueba valor a valor y motor a motor, sin necesidad de servidor.
/// </summary>
public sealed class DataScriptTests
{
    private static DatabaseColumn Column(string name, string type, int ordinal = 1) => new()
    {
        Name = name,
        DataType = type,
        IsNullable = true,
        Ordinal = ordinal,
    };

    private static ScriptedTable Table(params DatabaseColumn[] columns) => new()
    {
        Table = new DatabaseObject
        {
            Id = "ventas.pedidos",
            Name = "pedidos",
            Kind = DatabaseObjectKind.Table,
            Schema = "ventas",
        },
        Columns = columns,
        Structure = new TableStructure(),
    };

    public static TheoryData<IDatabaseScripter> Scripters() =>
    [
        new PostgreSqlTableDesigner(),
        new SqlServerTableDesigner(),
        new MySqlTableDesigner(),
        new InformixTableDesigner(),
    ];

    // -----------------------------------------------------------------------
    // Literales
    // -----------------------------------------------------------------------

    /// <summary>
    /// Lo que hace que una fila no pueda convertirse en instrucción: la comilla
    /// que lleva dentro se duplica y el literal sigue siendo un literal.
    /// </summary>
    [Theory]
    [MemberData(nameof(Scripters))]
    public void UnTextoConComillasNoEscapaDelLiteral(IDatabaseScripter scripter)
    {
        ArgumentNullException.ThrowIfNull(scripter);

        var literal = scripter.FormatLiteral(
            "O'Brien'); DROP TABLE clientes; --",
            Column("nombre", "VARCHAR(100)"));

        Assert.StartsWith("'", literal, StringComparison.Ordinal);
        Assert.EndsWith("'", literal, StringComparison.Ordinal);
        Assert.Contains("O''Brien''", literal, StringComparison.Ordinal);
    }

    /// <summary>
    /// En MySQL la barra invertida también escapa dentro de un literal. Doblar
    /// solo las comillas dejaría que un texto acabado en barra se comiera la
    /// comilla de cierre.
    /// </summary>
    [Fact]
    public void MySqlDoblaLaBarraInvertida()
    {
        var literal = new MySqlTableDesigner().FormatLiteral(
            @"C:\ruta\",
            Column("ruta", "VARCHAR(200)"));

        Assert.Equal(@"'C:\\ruta\\'", literal, StringComparer.Ordinal);
    }

    [Theory]
    [MemberData(nameof(Scripters))]
    public void UnNuloSeEscribeComoNulo(IDatabaseScripter scripter)
    {
        ArgumentNullException.ThrowIfNull(scripter);

        Assert.Equal("NULL", scripter.FormatLiteral(null, Column("nota", "TEXT")));
        Assert.Equal("NULL", scripter.FormatLiteral(DBNull.Value, Column("nota", "TEXT")));
    }

    /// <summary>
    /// Los números van sin comillas y con cultura invariante. Escribir `3,5`
    /// porque la máquina usa coma decimal daría un respaldo que se restaura como
    /// 35 en otro equipo, o que ni siquiera se ejecuta.
    /// </summary>
    [Theory]
    [MemberData(nameof(Scripters))]
    public void LosNumerosVanSinComillasYConPuntoDecimal(IDatabaseScripter scripter)
    {
        ArgumentNullException.ThrowIfNull(scripter);

        Assert.Equal("42", scripter.FormatLiteral(42, Column("cantidad", "INTEGER")));
        Assert.Equal("3.50", scripter.FormatLiteral(3.50m, Column("total", "DECIMAL(12,2)")));
        Assert.Equal("-1", scripter.FormatLiteral(-1L, Column("saldo", "BIGINT")));
    }

    /// <summary>
    /// Cada motor escribe la verdad a su manera, y ninguno entiende la de los
    /// otros: `true` en una columna `BIT` de SQL Server es un error.
    /// </summary>
    [Fact]
    public void CadaMotorEscribeLosBooleanosComoLosEntiende()
    {
        var column = Column("activo", "BOOLEAN");

        Assert.Equal("true", new PostgreSqlTableDesigner().FormatLiteral(true, column));
        Assert.Equal("1", new SqlServerTableDesigner().FormatLiteral(true, column));
        Assert.Equal("1", new MySqlTableDesigner().FormatLiteral(true, column));
        Assert.Equal("'t'", new InformixTableDesigner().FormatLiteral(true, column));

        Assert.Equal("false", new PostgreSqlTableDesigner().FormatLiteral(false, column));
        Assert.Equal("0", new SqlServerTableDesigner().FormatLiteral(false, column));
        Assert.Equal("'f'", new InformixTableDesigner().FormatLiteral(false, column));
    }

    [Fact]
    public void LosBinariosSeEscribenComoLosLeeCadaMotor()
    {
        var column = Column("firma", "BINARY");
        var bytes = new byte[] { 0x1A, 0x2B };

        Assert.Equal(@"'\x1a2b'", new PostgreSqlTableDesigner().FormatLiteral(bytes, column));
        Assert.Equal("0x1A2B", new SqlServerTableDesigner().FormatLiteral(bytes, column));

        // `X'…'` y no `0x…` porque una tira vacía tiene que seguir siendo válida:
        // `0x` es un error de sintaxis en MySQL y `X''` no.
        Assert.Equal("X'1A2B'", new MySqlTableDesigner().FormatLiteral(bytes, column));
        Assert.Equal("X''", new MySqlTableDesigner().FormatLiteral(Array.Empty<byte>(), column));
    }

    /// <summary>
    /// Informix no sabe escribir un binario dentro de una instrucción, y eso se
    /// dice en vez de escribir algo que no es el dato.
    /// </summary>
    [Fact]
    public void InformixDeclaraQueNoSabeEscribirBinarios()
    {
        var designer = new InformixTableDesigner();

        Assert.False(designer.Capabilities.SupportsBinaryLiterals);

        var error = Assert.Throws<NotSupportedException>(() =>
            designer.FormatLiteral(new byte[] { 0x00 }, Column("firma", "BYTE")));

        Assert.Contains("binario", error.Message, StringComparison.OrdinalIgnoreCase);
    }

    /// <summary>
    /// Las fechas se escriben con el mismo formato en los cuatro motores, que es
    /// el que ya usan la cuadrícula y las exportaciones.
    /// </summary>
    [Theory]
    [MemberData(nameof(Scripters))]
    public void LasFechasSeEscribenIgualEnTodosLosMotores(IDatabaseScripter scripter)
    {
        ArgumentNullException.ThrowIfNull(scripter);

        Assert.Equal(
            "'2026-08-17'",
            scripter.FormatLiteral(new DateOnly(2026, 8, 17), Column("dia", "DATE")));

        Assert.Equal(
            "'2026-08-17 14:03:11'",
            scripter.FormatLiteral(
                new DateTime(2026, 8, 17, 14, 3, 11, DateTimeKind.Unspecified),
                Column("creado_en", "TIMESTAMP")));
    }

    // -----------------------------------------------------------------------
    // Qué entra en el respaldo
    // -----------------------------------------------------------------------

    /// <summary>
    /// El caso que justifica la función: todo sin datos **salvo** unas cuantas
    /// tablas. Con un solo interruptor harían falta dos respaldos.
    /// </summary>
    [Fact]
    public void ElInterruptorGeneralGobiernaYLasAnulacionesMandan()
    {
        var selection = new DataSelection
        {
            Default = TableDataMode.StructureOnly,
            Overrides = new Dictionary<string, TableDataMode>(StringComparer.Ordinal)
            {
                ["ventas.paises"] = TableDataMode.StructureAndData,
            },
        };

        var pedidos = new DatabaseObject
        {
            Id = "1",
            Name = "pedidos",
            Kind = DatabaseObjectKind.Table,
            Schema = "ventas",
        };

        var paises = pedidos with { Id = "2", Name = "paises" };

        Assert.False(selection.IncludesData(pedidos));
        Assert.True(selection.IncludesStructure(pedidos));

        Assert.True(selection.IncludesData(paises));
        Assert.True(selection.IncludesStructure(paises));

        // La interfaz tiene que poder señalar lo que se sale de la regla: sin
        // verlo de un vistazo, nadie sabe qué va a obtener.
        Assert.Equal(["ventas.paises"], selection.Exceptions());
    }

    /// <summary>
    /// «Solo datos» sirve para recargar una base cuya estructura ya está puesta,
    /// así que lleva filas y no lleva definición.
    /// </summary>
    [Fact]
    public void SoloDatosNoEscribeLaDefinicion()
    {
        var selection = new DataSelection { Default = TableDataMode.DataOnly };

        var table = new DatabaseObject
        {
            Id = "1",
            Name = "pedidos",
            Kind = DatabaseObjectKind.Table,
            Schema = "ventas",
        };

        Assert.True(selection.IncludesData(table));
        Assert.False(selection.IncludesStructure(table));
    }

    /// <summary>
    /// En MySQL el esquema es la base, así que la clave de una tabla se forma con
    /// lo que traiga el objeto: sin eso, un perfil guardado no encontraría nunca
    /// sus anulaciones.
    /// </summary>
    [Fact]
    public void LaClaveDeUnaTablaUsaElContenedorQueTenga()
    {
        var conEsquema = new DatabaseObject
        {
            Id = "1",
            Name = "pedidos",
            Kind = DatabaseObjectKind.Table,
            Database = "tienda",
            Schema = "ventas",
        };

        var soloBase = conEsquema with { Schema = null };
        var suelta = conEsquema with { Schema = null, Database = null };

        Assert.Equal("ventas.pedidos", DataSelection.KeyOf(conEsquema));
        Assert.Equal("tienda.pedidos", DataSelection.KeyOf(soloBase));
        Assert.Equal("pedidos", DataSelection.KeyOf(suelta));
    }

    // -----------------------------------------------------------------------
    // Filtros
    // -----------------------------------------------------------------------

    private static ScriptedTable Clientes() => Table(
        new DatabaseColumn
        {
            Name = "id",
            DataType = "INTEGER",
            IsNullable = false,
            IsGenerated = true,
            Ordinal = 1,
        },
        new DatabaseColumn
        {
            Name = "nombre",
            DataType = "VARCHAR(100)",
            IsNullable = false,
            Ordinal = 2,
        },
        new DatabaseColumn
        {
            Name = "clave",
            DataType = "VARCHAR(100)",
            IsNullable = true,
            Ordinal = 3,
        });

    [Fact]
    public void UnFiltroSinNadaRaroSeAcepta()
    {
        var filter = new TableDataFilter
        {
            Where = "creado_en >= '2026-01-01'",
            MaxRows = 1000,
            ExcludedColumns = ["clave"],
        };

        Assert.Empty(filter.Validate(Clientes()));
        Assert.False(filter.IsEmpty);
    }

    /// <summary>
    /// La condición acaba dentro de un `SELECT` que arma Druse. Lo que la sacaría
    /// de ahí se rechaza antes de pegarla a nada.
    /// </summary>
    [Theory]
    [InlineData("1=1; DROP TABLE clientes")]
    [InlineData("1=1; DELETE FROM clientes")]
    public void UnaCondicionConSegundaInstruccionSeRechaza(string where)
    {
        var problems = new TableDataFilter { Where = where }.Validate(Clientes());

        Assert.NotEmpty(problems);
    }

    [Fact]
    public void UnaCondicionQueEscribeSeRechaza()
    {
        var problems = new TableDataFilter
        {
            Where = "id IN (SELECT id FROM x) OR (UPDATE clientes SET clave = '')",
        }.Validate(Clientes());

        Assert.Contains(problems, problem => problem.Contains("escriban", StringComparison.Ordinal));
    }

    /// <summary>
    /// Excluir una columna obligatoria sin valor por omisión deja un `INSERT` que
    /// el motor rechaza. Se dice al marcarla, no tres horas después.
    /// </summary>
    [Fact]
    public void ExcluirUnaColumnaObligatoriaSinValorPorOmisionSeRechaza()
    {
        var problems = new TableDataFilter { ExcludedColumns = ["nombre"] }.Validate(Clientes());

        Assert.Contains(problems, problem => problem.Contains("obligatoria", StringComparison.Ordinal));
    }

    /// <summary>
    /// La que genera el motor sí se puede excluir: no la escribe nadie, la rellena
    /// él.
    /// </summary>
    [Fact]
    public void ExcluirUnaColumnaQueGeneraElMotorSeAcepta()
    {
        Assert.Empty(new TableDataFilter { ExcludedColumns = ["id"] }.Validate(Clientes()));
    }

    [Fact]
    public void UnaColumnaQueNoExisteSeRechaza()
    {
        var problems = new TableDataFilter { ExcludedColumns = ["telefono"] }.Validate(Clientes());

        Assert.Contains(problems, problem => problem.Contains("no existe", StringComparison.Ordinal));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-5)]
    public void UnLimiteQueNoEsPositivoSeRechaza(int maxRows)
    {
        Assert.NotEmpty(new TableDataFilter { MaxRows = maxRows }.Validate(Clientes()));
    }

    /// <summary>
    /// Informix inserta una fila por instrucción: allí `VALUES (1), (2)` es un
    /// error de sintaxis, no una forma menos eficiente de escribirlo.
    /// </summary>
    [Fact]
    public void InformixDeclaraQueNoAgrupaFilasEnUnInsert()
    {
        Assert.Equal(1, new InformixTableDesigner().Capabilities.MaxRowsPerInsert);
        Assert.True(new PostgreSqlTableDesigner().Capabilities.MaxRowsPerInsert > 1);
    }

    /// <summary>
    /// Copiar los datos es copiar también sus claves, y SQL Server no deja
    /// escribir en una columna de identidad sin abrirle paso. Sobre una tabla que
    /// no la tiene, esa misma instrucción es un error, así que no se emite.
    /// </summary>
    [Fact]
    public void SqlServerAbrePasoALaIdentidadSoloDondeLaHay()
    {
        var designer = new SqlServerTableDesigner();

        var conIdentidad = Clientes();
        var sinIdentidad = Table(Column("nombre", "VARCHAR(100)"));

        Assert.Contains(
            "SET IDENTITY_INSERT [ventas].[pedidos] ON;",
            designer.BeginDataLoad(conIdentidad));

        Assert.Contains(
            "SET IDENTITY_INSERT [ventas].[pedidos] OFF;",
            designer.EndDataLoad(conIdentidad));

        Assert.Empty(designer.BeginDataLoad(sinIdentidad));
        Assert.Empty(designer.EndDataLoad(sinIdentidad));
    }

    /// <summary>Los demás motores admiten el valor explícito sin ceremonia.</summary>
    [Fact]
    public void LosDemasMotoresNoNecesitanAbrirPasoALaIdentidad()
    {
        Assert.Empty(new PostgreSqlTableDesigner().BeginDataLoad(Clientes()));
        Assert.Empty(new MySqlTableDesigner().BeginDataLoad(Clientes()));
        Assert.Empty(new InformixTableDesigner().BeginDataLoad(Clientes()));
    }
}
