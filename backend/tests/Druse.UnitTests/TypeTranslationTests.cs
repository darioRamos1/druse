using Druse.Application.Abstractions;
using Druse.Application.Transfers;
using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Informix;
using Druse.Provider.MySql;
using Druse.Provider.PostgreSql;
using Druse.Provider.SqlServer;

namespace Druse.UnitTests;

/// <summary>
/// Qué tipo tendría cada columna al llevarla a otro motor, y qué se pierde.
///
/// **Lo que se comprueba aquí no es el nombre del tipo, es el aviso.** Acertar
/// con que un `text` se llama `nvarchar(max)` importa poco; lo que decide si un
/// traslado entre motores sirve o estropea datos es que diga, antes de copiar,
/// qué deja de ser cierto en el destino.
/// </summary>
public sealed class TypeTranslationTests
{
    private static readonly TypeTranslator Translator = new(new Registry());

    private static DatabaseColumn Column(string name, string dataType) => new()
    {
        Name = name,
        DataType = dataType,
        IsNullable = true,
        Ordinal = 1,
    };

    private static TypeTranslation Translate(
        DatabaseEngine source,
        DatabaseEngine target,
        string dataType) =>
        Translator.Translate(source, target, [Column("c", dataType)])[0];

    // -----------------------------------------------------------------------
    // Lo que no se toca
    // -----------------------------------------------------------------------

    /// <summary>
    /// Dentro del mismo motor no se traduce nada.
    ///
    /// Proponer un equivalente sería cambiar una columna sin motivo: un
    /// `smallint` no tiene por qué convertirse en `bigint` porque los dos guarden
    /// enteros.
    /// </summary>
    [Fact]
    public void DentroDelMismoMotorElTipoSeQuedaComoEsta()
    {
        var translation = Translate(DatabaseEngine.PostgreSql, DatabaseEngine.PostgreSql, "smallint");

        Assert.Equal("smallint", translation.TargetType);
        Assert.Equal(TranslationFidelity.Exact, translation.Fidelity);
    }

    /// <summary>Un tipo escrito a mano se respeta y no se discute.</summary>
    [Fact]
    public void ElTipoQueEscribeElUsuarioManda()
    {
        var translation = Translator.Translate(
            DatabaseEngine.PostgreSql,
            DatabaseEngine.SqlServer,
            [Column("c", "jsonb")],
            new Dictionary<string, string> { ["c"] = "nvarchar(4000)" })[0];

        Assert.Equal("nvarchar(4000)", translation.TargetType);
        Assert.Equal(TranslationFidelity.Exact, translation.Fidelity);
        Assert.Null(translation.Note);
    }

    // -----------------------------------------------------------------------
    // Lo que se conserva
    // -----------------------------------------------------------------------

    /// <summary>Las medidas de un decimal viajan: son parte del dato, no del dialecto.</summary>
    [Theory]
    [InlineData(DatabaseEngine.SqlServer, "decimal(18,4)")]
    [InlineData(DatabaseEngine.MySql, "decimal(18,4)")]
    [InlineData(DatabaseEngine.Informix, "DECIMAL(18,4)")]
    public void LaPrecisionDeUnDecimalNoSePierde(DatabaseEngine target, string expected)
    {
        var translation = Translate(DatabaseEngine.PostgreSql, target, "numeric(18,4)");

        Assert.Equal(expected, translation.TargetType);
        Assert.Equal(TranslationFidelity.Exact, translation.Fidelity);
    }

    /// <summary>Y la longitud de un texto también.</summary>
    [Theory]
    [InlineData(DatabaseEngine.SqlServer, "nvarchar(200)")]
    [InlineData(DatabaseEngine.MySql, "varchar(200)")]
    [InlineData(DatabaseEngine.Informix, "VARCHAR(200)")]
    public void LaLongitudDeUnTextoNoSePierde(DatabaseEngine target, string expected)
    {
        var translation = Translate(DatabaseEngine.PostgreSql, target, "varchar(200)");

        Assert.Equal(expected, translation.TargetType);
    }

    /// <summary>
    /// Un texto sin límite tiene que llegar sin límite donde lo haya.
    ///
    /// Es el error que más duele si se hace mal: un `text` que aterrice como
    /// `nvarchar(1)` no falla al crear la tabla, falla al copiar la primera fila
    /// larga, y para entonces ya hay medio traslado hecho.
    /// </summary>
    [Theory]
    [InlineData(DatabaseEngine.SqlServer, "nvarchar(max)")]
    [InlineData(DatabaseEngine.MySql, "longtext")]
    public void UnTextoSinLimiteLlegaSinLimite(DatabaseEngine target, string expected)
    {
        var translation = Translate(DatabaseEngine.PostgreSql, target, "text");

        Assert.Equal(expected, translation.TargetType);
        Assert.Equal(TranslationFidelity.Exact, translation.Fidelity);
    }

    // -----------------------------------------------------------------------
    // Lo que se pierde, y se dice
    // -----------------------------------------------------------------------

    /// <summary>Un JSON que llega a un motor sin JSON deja de validarse.</summary>
    [Theory]
    [InlineData(DatabaseEngine.SqlServer)]
    [InlineData(DatabaseEngine.Informix)]
    public void UnJsonQueLlegaComoTextoSeAvisa(DatabaseEngine target)
    {
        var translation = Translate(DatabaseEngine.PostgreSql, target, "jsonb");

        Assert.Equal(TranslationFidelity.Approximate, translation.Fidelity);
        Assert.Contains("deja de comprobar", translation.Note!, StringComparison.Ordinal);
    }

    /// <summary>Pero en MySQL hay JSON, así que no hay nada que avisar.</summary>
    [Fact]
    public void UnJsonQueLlegaAMySqlSigueSiendoJson()
    {
        var translation = Translate(DatabaseEngine.PostgreSql, DatabaseEngine.MySql, "jsonb");

        Assert.Equal("json", translation.TargetType);
        Assert.Equal(TranslationFidelity.Exact, translation.Fidelity);
    }

    /// <summary>Un identificador único donde no existe se guarda escrito.</summary>
    [Theory]
    [InlineData(DatabaseEngine.MySql, "char(36)")]
    [InlineData(DatabaseEngine.Informix, "CHAR(36)")]
    public void UnIdentificadorUnicoSinTipoPropioSeAvisa(DatabaseEngine target, string expected)
    {
        var translation = Translate(DatabaseEngine.PostgreSql, target, "uuid");

        Assert.Equal(expected, translation.TargetType);
        Assert.Equal(TranslationFidelity.Approximate, translation.Fidelity);
        Assert.Contains("36 caracteres", translation.Note!, StringComparison.Ordinal);
    }

    /// <summary>Y donde sí existe, no se dice nada.</summary>
    [Fact]
    public void UnIdentificadorUnicoConTipoPropioNoAvisaDeNada()
    {
        var translation = Translate(DatabaseEngine.PostgreSql, DatabaseEngine.SqlServer, "uuid");

        Assert.Equal("uniqueidentifier", translation.TargetType);
        Assert.Equal(TranslationFidelity.Exact, translation.Fidelity);
    }

    /// <summary>
    /// La zona horaria se pierde donde el motor no la guarda.
    ///
    /// El instante se conserva —MySQL convierte a UTC— pero de qué huso venía no,
    /// y eso cambia lo que se lee en pantalla.
    /// </summary>
    [Theory]
    [InlineData(DatabaseEngine.MySql)]
    [InlineData(DatabaseEngine.Informix)]
    public void LaZonaHorariaQueNoSeGuardaSeAvisa(DatabaseEngine target)
    {
        var translation = Translate(DatabaseEngine.PostgreSql, target, "timestamptz");

        Assert.Equal(TranslationFidelity.Approximate, translation.Fidelity);
        Assert.Contains("zona horaria", translation.Note!, StringComparison.Ordinal);
    }

    /// <summary>Un booleano que llega como número se dice.</summary>
    [Fact]
    public void UnBooleanoQueLlegaComoNumeroSeAvisa()
    {
        var translation = Translate(DatabaseEngine.PostgreSql, DatabaseEngine.Informix, "boolean");

        Assert.Equal("SMALLINT", translation.TargetType);
        Assert.Equal(TranslationFidelity.Approximate, translation.Fidelity);
        Assert.Contains("1 y 0", translation.Note!, StringComparison.Ordinal);
    }

    /// <summary>
    /// Lo que era ilimitado y llega con tope se avisa aunque hoy quepa.
    ///
    /// Cabe lo que hay; lo que se escriba después, quizá no. Es un aviso sobre el
    /// futuro de la tabla, no sobre esta copia.
    /// </summary>
    [Fact]
    public void UnTextoIlimitadoQueLlegaConTopeSeAvisa()
    {
        var translation = Translate(DatabaseEngine.PostgreSql, DatabaseEngine.Informix, "text");

        Assert.Equal(TranslationFidelity.Approximate, translation.Fidelity);
        Assert.Contains("32739", translation.Note!, StringComparison.Ordinal);
    }

    /// <summary>
    /// Una columna con varios valores no tiene dónde ir, y no se traduce a la
    /// fuerza.
    ///
    /// Copiarla como texto dejaría dentro la representación del conjunto —`{a,b}`—
    /// y nadie volvería a leer sus elementos como elementos.
    /// </summary>
    [Theory]
    [InlineData(DatabaseEngine.SqlServer)]
    [InlineData(DatabaseEngine.MySql)]
    [InlineData(DatabaseEngine.Informix)]
    public void UnaColumnaDeVariosValoresNoTieneEquivalente(DatabaseEngine target)
    {
        var translation = Translate(DatabaseEngine.PostgreSql, target, "text[]");

        Assert.Equal(TranslationFidelity.None, translation.Fidelity);
        Assert.Contains("excluir la columna", translation.Note!, StringComparison.Ordinal);
    }

    // -----------------------------------------------------------------------
    // Lo que hereda un motor nuevo
    // -----------------------------------------------------------------------

    /// <summary>
    /// Un motor recién llegado **no hereda «lo conserva todo»**.
    ///
    /// Es la regresión que se quiere impedir: mientras la tabla de familias vivía
    /// aquí dentro, su rama final daba por bueno cualquier motor que nadie
    /// hubiera contemplado. El asistente de traslado decía «traducción exacta» y
    /// la pérdida se descubría después de copiar los datos.
    ///
    /// Ahora la respuesta la da el motor, y un motor que declare que no guarda
    /// booleanos lo avisa aunque nadie haya oído hablar de él.
    /// </summary>
    [Fact]
    public void UnMotorDesconocidoQueNoGuardaBooleanosLoAvisa()
    {
        var translation = Translate(DatabaseEngine.PostgreSql, Inventado, "boolean");

        Assert.Equal(TranslationFidelity.Approximate, translation.Fidelity);
        Assert.Contains("1 y 0", translation.Note!, StringComparison.Ordinal);
    }

    /// <summary>Y si dice que sí los guarda, no se inventa un aviso.</summary>
    [Fact]
    public void UnMotorDesconocidoQueSiGuardaBooleanosNoAvisaDeNada()
    {
        var translator = new TypeTranslator(new Registry(new[] { ColumnFamily.Boolean }));

        var translation = translator.Translate(
            DatabaseEngine.PostgreSql,
            Inventado,
            [Column("c", "boolean")])[0];

        Assert.Equal(TranslationFidelity.Exact, translation.Fidelity);
        Assert.Null(translation.Note);
    }

    /// <summary>Un motor que el enumerado no nombra: sirve para representar al que venga.</summary>
    private const DatabaseEngine Inventado = (DatabaseEngine)99;

    // -----------------------------------------------------------------------
    // Las medidas que se leen del tipo
    // -----------------------------------------------------------------------

    [Theory]
    [InlineData("varchar(200)", ColumnFamily.Text, 200)]
    [InlineData("VARCHAR(50)", ColumnFamily.Text, 50)]
    [InlineData("nvarchar(max)", ColumnFamily.Text, null)]
    [InlineData("text", ColumnFamily.Text, null)]
    [InlineData("int8", ColumnFamily.Integral, null)]
    public void LasMedidasSeLeenDelParentesisYNoDelNombre(
        string dataType,
        ColumnFamily family,
        int? length)
    {
        var facets = TypeFacets.Parse(dataType);

        Assert.Equal(family, facets.Family);
        Assert.Equal(length, facets.Length);
    }

    [Fact]
    public void UnDecimalTraePrecisionYEscala()
    {
        var facets = TypeFacets.Parse("numeric(18,4)");

        Assert.Equal(ColumnFamily.Fractional, facets.Family);
        Assert.Equal(18, facets.Precision);
        Assert.Equal(4, facets.Scale);
    }

    /// <summary>
    /// Registro que entrega los diseñadores y los proveedores de los cuatro
    /// motores.
    ///
    /// Los proveedores hacen falta porque son ellos quienes dicen qué familias de
    /// datos guarda cada motor con un tipo propio. Dejarlos sin implementar
    /// significaría probar el traductor contra unas capacidades inventadas, y lo
    /// que aquí se comprueba es precisamente que el aviso salga de lo que el
    /// motor declara de sí mismo.
    /// </summary>
    private sealed class Registry(IReadOnlyList<ColumnFamily>? inventadas = null) : IProviderRegistry
    {
        /// <summary>Lo que guarda el motor inventado. Vacío mientras nadie diga otra cosa.</summary>
        private readonly IReadOnlyList<ColumnFamily> _inventadas = inventadas ?? [];

        public IReadOnlyCollection<DatabaseEngine> SupportedEngines =>
            [.. Enum.GetValues<DatabaseEngine>()];

        public ITableDesigner GetTableDesigner(DatabaseEngine engine) => engine switch
        {
            DatabaseEngine.PostgreSql => new PostgreSqlTableDesigner(),
            DatabaseEngine.SqlServer => new SqlServerTableDesigner(),
            DatabaseEngine.MySql => new MySqlTableDesigner(),
            Inventado => new PostgreSqlTableDesigner(),
            _ => new InformixTableDesigner(),
        };

        public IDatabaseProvider GetProvider(DatabaseEngine engine) => engine switch
        {
            DatabaseEngine.PostgreSql => new PostgreSqlDatabaseProvider(),
            DatabaseEngine.SqlServer => new SqlServerDatabaseProvider(),
            DatabaseEngine.MySql => new MySqlDatabaseProvider(),
            DatabaseEngine.InformixSqli => new InformixDatabaseProvider(engine),
            Inventado => new MotorInventado(_inventadas),
            _ => new InformixDatabaseProvider(),
        };

        public IDatabaseMetadataReader GetMetadataReader(DatabaseEngine engine) =>
            throw new NotSupportedException();

        public IQueryExecutor GetQueryExecutor(DatabaseEngine engine) =>
            throw new NotSupportedException();

        public IRowEditor GetRowEditor(DatabaseEngine engine) =>
            throw new NotSupportedException();

        public IDatabaseScripter GetScripter(DatabaseEngine engine) =>
            throw new NotSupportedException();
    }

    /// <summary>
    /// Un motor que solo sabe contestar qué guarda.
    ///
    /// Representa al proveedor que alguien añada mañana: lo único que el
    /// traductor le pide es eso, y el contrato le obliga a decirlo.
    /// </summary>
    private sealed class MotorInventado(IReadOnlyList<ColumnFamily> familias) : IDatabaseProvider
    {
        public DatabaseEngine Engine => Inventado;

        public EngineCapabilities Capabilities { get; } = new() { NativeFamilies = familias };

        public int DefaultPort => 1234;

        public string DefaultDatabase => string.Empty;

        public IReadOnlyList<string> SystemDatabases => [];

        public Task<TestConnectionResult> TestConnectionAsync(
            ConnectionProfile profile,
            DatabaseCredentials credentials,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<IDatabaseSession> OpenSessionAsync(
            ConnectionProfile profile,
            DatabaseCredentials credentials,
            CancellationToken cancellationToken) => throw new NotSupportedException();

        public Task<IDatabaseSession> OpenDatabaseSessionAsync(
            IDatabaseSession source,
            string database,
            CancellationToken cancellationToken) => throw new NotSupportedException();
    }
}
