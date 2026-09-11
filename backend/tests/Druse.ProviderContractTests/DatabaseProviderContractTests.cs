using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.ProviderContractTests;

/// <summary>
/// Conjunto contractual que **todo proveedor** debe superar (plan §11).
///
/// Las clases derivadas solo aportan la conexión y las diferencias de dialecto
/// declaradas en <see cref="IProviderFixture"/>. Lo que se comprueba es idéntico
/// para todos los motores: si alguna vez hubiera que cambiar una comprobación
/// para que pase en un motor concreto, sería señal de que se coló una fuga de
/// dialecto en las abstracciones.
///
/// Cuando el servidor no está disponible, las pruebas terminan sin comprobar
/// nada en lugar de fallar: una máquina sin Docker no debería dar por rota la
/// suite entera.
/// </summary>
public abstract class DatabaseProviderContractTests<TFixture>
    where TFixture : IProviderFixture, new()
{
    protected DatabaseProviderContractTests()
    {
        Fixture = new TFixture();
    }

    protected TFixture Fixture { get; }

    private bool Skip => !Fixture.IsAvailable;

    /// <summary>
    /// Comprueba que el motor estaba realmente disponible.
    ///
    /// Las demás pruebas terminan sin hacer nada cuando falta el servidor, y eso
    /// tiene un riesgo: una suite entera en verde que en realidad no comprobó
    /// nada. Con `DRUSE_REQUIRE_ENGINES=1` —lo que hace la integración continua—
    /// esa situación pasa a ser un fallo en lugar de un silencio.
    /// </summary>
    [Fact]
    public void ElMotorEstabaDisponible()
    {
        var required = Environment.GetEnvironmentVariable("DRUSE_REQUIRE_ENGINES") == "1";

        Assert.True(
            Fixture.IsAvailable || !required,
            $"Se exigían todos los motores y {Fixture.EngineName} no respondió. " +
            $"Motivo: {Fixture.UnavailableReason ?? "desconocido"}. " +
            "Levanta el contenedor con build/scripts/test-db.ps1.");
    }

    private async Task<IDatabaseSession> OpenAsync(bool onlyRead = false) =>
        await Fixture.Provider.OpenSessionAsync(
            Fixture.Profile(onlyRead),
            Fixture.Credentials,
            CancellationToken.None);

    private async Task<IDatabaseSession> OpenDatabaseAsync(
        string database,
        bool onlyRead = false) =>
        await Fixture.Provider.OpenSessionAsync(
            Fixture.ProfileForDatabase(database, onlyRead),
            Fixture.Credentials,
            CancellationToken.None);

    private static QueryRequest Query(string sql, int maxRows = 500, int timeoutSeconds = 30) => new()
    {
        SessionId = Guid.NewGuid(),
        Sql = sql,
        MaxRows = maxRows,
        TimeoutSeconds = timeoutSeconds,
        DestructiveConfirmed = true,
    };

    private Task<QueryResult> ExecuteAsync(
        IDatabaseSession session,
        string sql,
        int maxRows = 500,
        int timeoutSeconds = 30,
        CancellationToken cancellationToken = default) =>
        Fixture.Executor.ExecuteAsync(session, Query(sql, maxRows, timeoutSeconds), cancellationToken);

    // -----------------------------------------------------------------------
    // Conexión
    // -----------------------------------------------------------------------

    [Fact]
    public async Task ConexionValida_Funciona()
    {
        if (Skip) { return; }

        var result = await Fixture.Provider.TestConnectionAsync(
            Fixture.Profile(),
            Fixture.Credentials,
            CancellationToken.None);

        Assert.True(result.Succeeded, result.Error?.Message);
        Assert.False(string.IsNullOrWhiteSpace(result.ServerVersion));
    }

    /// <summary>
    /// Una contraseña equivocada no entra, y el mensaje que se enseña no la
    /// lleva dentro.
    ///
    /// **Donde no hay identidad no hay nada que comprobar**: en SQLite se abre un
    /// archivo, y la contraseña que se le pase da igual porque no se usa. Se
    /// pregunta al motor —que ya declara si pide usuario— en vez de declararlo
    /// otra vez aquí.
    /// </summary>
    [Fact]
    public async Task ConexionConCredencialesMalas_FallaSinRevelarLaContrasena()
    {
        if (Skip || !Fixture.Provider.Capabilities.RequiresUsername) { return; }

        const string WrongPassword = "contrasena-incorrecta-de-prueba";

        var result = await Fixture.Provider.TestConnectionAsync(
            Fixture.Profile(),
            new DatabaseCredentials(WrongPassword),
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.NotNull(result.Error);

        // El error se muestra al usuario: no puede llevar la contraseña dentro
        // (plan §12).
        Assert.DoesNotContain(WrongPassword, result.Error.Message, StringComparison.Ordinal);
    }

    /// <summary>
    /// Un destino que no existe se dice, y se dice con algo que se pueda leer.
    ///
    /// Para cinco motores el destino es un servidor y para SQLite es un archivo,
    /// así que **lo que cambia es a dónde apuntar mal**, no lo que se exige: en
    /// los dos casos hay que fallar en vez de quedarse en silencio. En SQLite eso
    /// es además la decisión de fondo del motor —abrir no crea— y esta es la
    /// prueba que la sostiene desde el contrato común.
    /// </summary>
    [Fact]
    public async Task ConexionAUnHostInexistente_FallaConMensajeUtil()
    {
        if (Skip) { return; }

        var result = await Fixture.Provider.TestConnectionAsync(
            Fixture.ProfileToNowhere(),
            Fixture.Credentials,
            CancellationToken.None);

        Assert.False(result.Succeeded);
        Assert.NotNull(result.Error);
        Assert.False(string.IsNullOrWhiteSpace(result.Error.Message));
    }

    [Fact]
    public async Task AbrirYCerrarSesion()
    {
        if (Skip) { return; }

        var session = await OpenAsync();

        Assert.True(session.IsOpen);
        Assert.NotEqual(Guid.Empty, session.Id);
        Assert.False(string.IsNullOrWhiteSpace(session.ServerVersion));

        await session.DisposeAsync();

        Assert.False(session.IsOpen);
    }

    // -----------------------------------------------------------------------
    // Consultas
    // -----------------------------------------------------------------------

    [Fact]
    public async Task SelectSimple_DevuelveColumnasYFilas()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, "SELECT 1 AS numero, 'texto' AS palabra");

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        var set = Assert.Single(result.ResultSets);
        Assert.Equal(2, set.Columns.Count);
        Assert.Equal(Fixture.Stored("numero"), set.Columns[0].Name);
        Assert.Equal(["1", "texto"], set.Rows[0]);
    }

    [Fact]
    public async Task SelectSinFilas_DevuelveColumnasIgualmente()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, "SELECT 1 AS n WHERE 1 = 0");

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        var set = Assert.Single(result.ResultSets);
        Assert.Single(set.Columns);
        Assert.Empty(set.Rows);
    }

    [Fact]
    public async Task ValoresNulos_LleganComoNullYNoComoCadenaVacia()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, Fixture.SelectNullAndEmpty);
        var row = result.ResultSets[0].Rows[0];

        Assert.Null(row[0]);

        // Un motor sin cadenas vacías —Oracle— llega hasta aquí: allí `''` **es**
        // nulo, así que lo que se comprueba es que las dos columnas se lean
        // igual, no que la segunda traiga un texto de cero caracteres que el
        // motor no sabe representar.
        if (!Fixture.HasEmptyStrings)
        {
            Assert.Null(row[1]);
            return;
        }

        Assert.Equal(string.Empty, row[1]);
    }

    [Fact]
    public async Task TiposBasicos_SeFormateanIgualEnTodosLosMotores()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, Fixture.SelectBasicTypes);

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        var row = result.ResultSets[0].Rows[0];

        Assert.Equal("42", row[0]);
        // Cultura invariante: punto decimal, no la coma de la máquina.
        Assert.Equal("3.5", row[1]);
        // El booleano se normaliza aunque SQL Server no tenga tipo booleano.
        Assert.Equal(Fixture.TransportsBooleans ? "true" : "1", row[2]);
        // La fecha se lee igual venga del motor que venga.
        Assert.StartsWith("2026-08-11", row[3], StringComparison.Ordinal);
    }

    [Fact]
    public async Task ErrorDeSintaxis_DevuelveEstadoFallidoConCodigo()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, Fixture.InvalidSyntax);

        Assert.Equal(QueryExecutionState.Failed, result.State);
        Assert.NotNull(result.Error);
        Assert.Equal(Fixture.SyntaxErrorCode, result.Error.Code);
        Assert.False(string.IsNullOrWhiteSpace(result.Error.Message));
    }

    /// <summary>
    /// Un error de sintaxis dice **dónde**, hasta donde el motor sepa decirlo.
    ///
    /// Es lo que el editor subraya: con la posición se marca la palabra culpable,
    /// con la línea la línea entera, y sin nada no se marca. Lo que se comprueba
    /// aquí es que lo declarado en la fixture y lo que el motor entrega de verdad
    /// no se separen —si un día IBM empieza a dar la línea, esta prueba se pone
    /// roja y nos enteramos— y, sobre todo, que **lo que llegue apunte a la línea
    /// correcta**: un error mal situado es peor que uno sin situar.
    /// </summary>
    [Fact]
    public async Task ErrorDeSintaxis_DiceDondeHastaDondeElMotorSabe()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        // El error está en la tercera línea a propósito: con todo en una sola,
        // cualquier número valdría y la prueba no distinguiría nada.
        const string Sql = "SELECT\n  uno,\n  FROM tabla_x";

        var result = await ExecuteAsync(session, Sql);

        Assert.Equal(QueryExecutionState.Failed, result.State);
        Assert.NotNull(result.Error);

        switch (Fixture.SyntaxErrorPlace)
        {
            case SyntaxErrorPlace.Position:
                Assert.NotNull(result.Error.Position);

                // La posición se cuenta desde uno sobre el SQL enviado, así que
                // lo que hay antes tiene que ser justo las dos primeras líneas.
                var antes = Sql[..(result.Error.Position!.Value - 1)];

                Assert.Equal(2, antes.Count(character => character == '\n'));
                break;

            case SyntaxErrorPlace.Line:
                Assert.Equal(3, result.Error.Line);
                break;

            default:
                Assert.Null(result.Error.Position);
                Assert.Null(result.Error.Line);
                break;
        }
    }

    [Fact]
    public async Task TablaInexistente_DevuelveErrorNormalizado()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, "SELECT * FROM tabla_que_no_existe_jamas");

        Assert.Equal(QueryExecutionState.Failed, result.State);
        Assert.NotNull(result.Error);
        Assert.Equal(Fixture.MissingTableCode, result.Error.Code);
    }

    [Fact]
    public async Task VariosConjuntosDeResultados()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, Fixture.ThreeResultSets);

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        Assert.Equal(3, result.ResultSets.Count);
        Assert.Equal(Fixture.Stored("a"), result.ResultSets[0].Columns[0].Name);
        Assert.Equal(Fixture.Stored("c"), result.ResultSets[2].Columns[0].Name);
    }

    [Fact]
    public async Task LimiteDeFilas_RecortaYAvisa()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, Fixture.GenerateRows(1000), maxRows: 10);
        var set = result.ResultSets[0];

        Assert.Equal(10, set.Rows.Count);
        // Recortar en silencio llevaría a sacar conclusiones equivocadas.
        Assert.True(set.Truncated);
    }

    /// <summary>
    /// El tope de filas es de la pulsación entera, no de cada resultado.
    ///
    /// Se aplicaba a cada uno por separado: un lote con tres `SELECT` y un tope de
    /// dos traía seis filas a la memoria del proceso y del navegador. Con diez
    /// instrucciones —que es lo normal en un guion— el tope dejaba de significar
    /// nada.
    ///
    /// Lo que se comprueba es la suma, y que lo que se queda fuera se dice: un
    /// resultado vacío sin marca se lee como «esa consulta no devolvió nada».
    /// </summary>
    [Fact]
    public async Task LimiteDeFilas_ValeParaElLoteEntero()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, Fixture.ThreeResultSets, maxRows: 2);

        Assert.Equal(QueryExecutionState.Succeeded, result.State);
        Assert.Equal(3, result.ResultSets.Count);

        var total = result.ResultSets.Sum(set => set.Rows.Count);

        Assert.True(total <= 2, $"El lote trajo {total} filas con un tope de 2.");

        // Las dos primeras caben —una fila cada una— y la tercera se queda fuera,
        // dicho.
        Assert.True(result.ResultSets[2].Truncated);
    }

    [Fact]
    public async Task LimiteDeFilas_NoMarcaTruncadoSiCabeEntero()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, Fixture.GenerateRows(5), maxRows: 10);

        Assert.Equal(5, result.ResultSets[0].Rows.Count);
        Assert.False(result.ResultSets[0].Truncated);
    }

    [Fact]
    public async Task Cancelacion_DetieneLaConsulta()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        using var cancellation = new CancellationTokenSource();
        cancellation.CancelAfter(TimeSpan.FromMilliseconds(500));

        var result = await ExecuteAsync(
            session,
            Fixture.Sleep(30),
            timeoutSeconds: 60,
            cancellationToken: cancellation.Token);

        Assert.Equal(QueryExecutionState.Canceled, result.State);
        // Cancelar debe cortar de verdad, no esperar a que el servidor termine.
        Assert.True(
            result.Duration < TimeSpan.FromSeconds(15),
            $"Tardó {result.Duration.TotalSeconds:F1} s en cancelarse.");
    }

    [Fact]
    public async Task Timeout_TerminaSinEsperarAlServidor()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, Fixture.Sleep(30), timeoutSeconds: 1);

        Assert.NotEqual(QueryExecutionState.Succeeded, result.State);
        Assert.True(
            result.Duration < TimeSpan.FromSeconds(20),
            $"Tardó {result.Duration.TotalSeconds:F1} s en agotar el tiempo.");
    }

    [Fact]
    public async Task InstruccionesQueEscriben_ReportanFilasAfectadas()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_tmp_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateTable(table));

            var insert = await ExecuteAsync(session, Fixture.InsertThreeRows(table));

            Assert.Equal(QueryExecutionState.Succeeded, insert.State);
            Assert.Equal(3, insert.RowsAffected);
            Assert.Empty(insert.ResultSets);
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    [Fact]
    public async Task MensajesDelServidor_LleganAlResultado()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var result = await ExecuteAsync(session, Fixture.RaiseNotice("hola desde el servidor"));

        Assert.Equal(QueryExecutionState.Succeeded, result.State);

        // Un motor sin avisos —Informix— llega hasta aquí: la consulta se ejecuta
        // y termina bien. Lo que no puede comprobarse es lo que ese motor no
        // produce.
        if (!Fixture.EmitsServerNotices)
        {
            return;
        }

        Assert.Contains(
            result.Messages,
            message => message.Text.Contains("hola desde el servidor", StringComparison.Ordinal));
    }

    // -----------------------------------------------------------------------
    // Metadatos
    // -----------------------------------------------------------------------

    [Fact]
    public async Task ListaBasesDeDatos()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var databases = await Fixture.Metadata.GetDatabasesAsync(session, CancellationToken.None);

        Assert.NotEmpty(databases);
        Assert.All(databases, database => Assert.Equal(DatabaseObjectKind.Database, database.Kind));
        Assert.Contains(databases, database => database.Name == Fixture.DatabaseName);
    }

    [Fact]
    public async Task ListaEsquemasSinLosDelSistema()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var database = new DatabaseObject
        {
            Id = $"db:{Fixture.DatabaseName}",
            Name = Fixture.DatabaseName,
            Kind = DatabaseObjectKind.Database,
            Database = Fixture.DatabaseName,
        };

        var schemas = await Fixture.Metadata.GetChildrenAsync(session, database, CancellationToken.None);

        Assert.Contains(schemas, schema => schema.Name == Fixture.DefaultSchema);
        Assert.DoesNotContain(schemas, schema => schema.Name == "sys");
        Assert.DoesNotContain(schemas, schema => schema.Name == "pg_catalog");
        Assert.DoesNotContain(schemas, schema => schema.Name == "INFORMATION_SCHEMA");
        Assert.DoesNotContain(schemas, schema => schema.Name == "information_schema");
    }

    [Fact]
    public async Task ElEsquemaOfreceLasMismasCarpetasEnTodosLosMotores()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var schema = new DatabaseObject
        {
            Id = $"schema:{Fixture.DefaultSchema}",
            Name = Fixture.DefaultSchema,
            Kind = DatabaseObjectKind.Schema,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        var folders = await Fixture.Metadata.GetChildrenAsync(session, schema, CancellationToken.None);

        Assert.All(folders, folder => Assert.Equal(DatabaseObjectKind.Folder, folder.Kind));

        // Un motor sin rutinas no enseña sus dos carpetas vacías: eso diría que la
        // base no tiene ninguna, cuando lo que pasa es que el motor no sabe lo que
        // son.
        Assert.Equal(
            Fixture.HasRoutines
                ? ["Tables", "Views", "Functions", "Procedures"]
                : (string[])["Tables", "Views"],
            folders.Select(folder => folder.Name));
    }

    [Fact]
    public async Task ListaTablasYSusColumnas()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_tmp_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateTableWithColumns(table));

            var folder = new DatabaseObject
            {
                Id = $"folder:{Fixture.DefaultSchema}:tables",
                Name = "Tables",
                Kind = DatabaseObjectKind.Folder,
                Database = Fixture.DatabaseName,
                Schema = Fixture.DefaultSchema,
            };

            var tables = await Fixture.Metadata.GetChildrenAsync(session, folder, CancellationToken.None);
            var created = Assert.Single(tables, item => item.Name == table);

            Assert.Equal(DatabaseObjectKind.Table, created.Kind);

            var columns = await Fixture.Metadata.GetColumnsAsync(session, created, CancellationToken.None);

            Assert.Equal(4, columns.Count);

            var id = columns[0];
            Assert.Equal(Fixture.Stored("id"), id.Name);
            Assert.True(id.IsPrimaryKey);
            Assert.False(id.IsNullable);
            Assert.True(id.IsGenerated);

            Assert.False(columns[1].IsNullable);

            var opcional = columns[2];
            Assert.True(opcional.IsNullable);
            Assert.False(opcional.IsPrimaryKey);

            var conDefecto = columns[3];
            Assert.Equal(Fixture.TimestampTypeName, conDefecto.DataType);
            Assert.False(string.IsNullOrWhiteSpace(conDefecto.DefaultValue));
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    /// <summary>
    /// Un cambio de tabla que falla a mitad dice **cuál** instrucción falló y qué
    /// quedó aplicado.
    ///
    /// Es la diferencia entre «no se pudo» y «tu tabla ya no es la que era». Tres
    /// de los cuatro motores deshacen el DDL y no queda nada; MySQL confirma cada
    /// `ALTER` por su cuenta, así que lo anterior se queda —y hay que decirlo, o
    /// quien vuelva al diseñador estará partiendo de otra cosa—.
    ///
    /// El motor no se nombra en ningún sitio: lo que manda es lo que cada
    /// proveedor promete en `SupportsTransactionalDdl`.
    /// </summary>
    [Fact]
    public async Task UnCambioQueFallaAMitadDiceQueQuedoAplicado()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_mid_{Guid.NewGuid().ToString("N")[..8]}");

        var target = new DatabaseObject
        {
            Id = table,
            Name = table,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = table,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                        },
                    ],
                },
                CancellationToken.None);

            // Primero algo que sí se puede hacer, y después algo imposible: un
            // índice sobre una columna que no existe. Ese orden es el que deja la
            // tabla a medias donde el motor no sabe deshacerlo.
            var alteration = new TableAlteration
            {
                Table = target,
                AddedColumns =
                [
                    new TableColumnDefinition { Name = "apodo", DataType = "VARCHAR(30)" },
                ],
                AddedIndexes =
                [
                    new IndexDefinition
                    {
                        Name = Fixture.Stored($"ix_{table}"),
                        Columns = [new IndexColumn { Name = "no_existe" }],
                    },
                ],
            };

            var failure = await Assert.ThrowsAsync<TableChangeFailedException>(
                () => Fixture.Designer.AlterAsync(session, alteration, CancellationToken.None));

            // Qué falló, con su texto: un «error de sintaxis» suelto no se
            // diagnostica sin la instrucción delante.
            Assert.Contains("no_existe", failure.Statement, StringComparison.OrdinalIgnoreCase);
            Assert.False(string.IsNullOrWhiteSpace(failure.Error.Message));

            // Y qué pasó con lo anterior, que es lo que decide el siguiente paso.
            Assert.Equal(Fixture.Designer.SupportsTransactionalDdl, failure.Reverted);

            var columns = await Fixture.Metadata.GetColumnsAsync(
                session,
                target,
                CancellationToken.None);

            var quedo = columns.Any(column =>
                string.Equals(column.Name, "apodo", StringComparison.OrdinalIgnoreCase));

            // La tabla cuenta lo mismo que el aviso: donde se deshace no quedó
            // nada, y donde no, la columna está.
            Assert.Equal(!failure.Reverted, quedo);

            if (!failure.Reverted)
            {
                Assert.Contains("ya están aplicadas", failure.Message, StringComparison.Ordinal);
            }
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    /// <summary>
    /// Renombra una columna y le cambia el tipo, y vuelve a leerla.
    ///
    /// Es lo que más se usa del diseñador después de crear, y lo que peor se
    /// parece entre motores: PostgreSQL tiene `RENAME COLUMN` y `ALTER COLUMN
    /// TYPE`, SQL Server necesita un procedimiento del sistema para renombrar,
    /// MySQL rehace la columna entera con `CHANGE` —y hay que repetirle todo lo
    /// que ya tenía— e Informix las trata con `MODIFY`.
    ///
    /// Las dos cosas van en la **misma** alteración a propósito: por separado
    /// cada motor acierta; juntas es donde se ve si el orden es el correcto y si
    /// el segundo paso usa el nombre nuevo o el viejo.
    /// </summary>
    [Fact]
    public async Task RenombraUnaColumnaYLeCambiaElTipo()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_col_{Guid.NewGuid().ToString("N")[..8]}");

        var target = new DatabaseObject
        {
            Id = table,
            Name = table,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = table,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                        },
                        new TableColumnDefinition
                        {
                            Name = "correo",
                            DataType = "VARCHAR(50)",
                        },
                    ],
                },
                CancellationToken.None);

            await Fixture.Designer.AlterAsync(
                session,
                new TableAlteration
                {
                    Table = target,
                    AlteredColumns =
                    [
                        new ColumnAlteration
                        {
                            CurrentName = "correo",
                            Column = new TableColumnDefinition
                            {
                                Name = "email",
                                DataType = "VARCHAR(120)",
                            },
                        },
                    ],
                },
                CancellationToken.None);

            var columns = await Fixture.Metadata.GetColumnsAsync(
                session,
                target,
                CancellationToken.None);

            Assert.DoesNotContain(
                columns,
                column => string.Equals(column.Name, "correo", StringComparison.OrdinalIgnoreCase));

            var email = Assert.Single(
                columns,
                column => string.Equals(column.Name, "email", StringComparison.OrdinalIgnoreCase));

            // El nombre del tipo lo escribe cada motor a su manera; lo que tiene
            // que estar es el tamaño nuevo, que es lo que se pidió cambiar.
            Assert.Contains("120", email.DataType, StringComparison.Ordinal);
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    /// <summary>
    /// Cambia la clave primaria de una tabla: suelta la que había y pone otra.
    ///
    /// Es la operación que menos se deshace del diseñador, y la que más depende
    /// del nombre: para soltarla hay que nombrarla, y el nombre lo pone el motor
    /// cuando la clave nació sin él. Por eso se lee del catálogo antes de soltar,
    /// que es exactamente lo que hace la pantalla.
    /// </summary>
    [Fact]
    public async Task CambiaLaClavePrimariaDeUnaTabla()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_pk_{Guid.NewGuid().ToString("N")[..8]}");

        var target = new DatabaseObject
        {
            Id = table,
            Name = table,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            // Sin identidad a propósito: MySQL no deja soltar la clave de una
            // columna autoincremental, y lo que se prueba aquí es la clave, no esa
            // limitación.
            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = table,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                        },
                        new TableColumnDefinition
                        {
                            Name = "codigo",
                            DataType = "VARCHAR(20)",
                            IsNullable = false,
                        },
                    ],
                },
                CancellationToken.None);

            var before = await Fixture.Metadata.GetTableStructureAsync(
                session,
                target,
                CancellationToken.None);

            Assert.NotNull(before.PrimaryKey);
            Assert.Equal([Fixture.Stored("id")], before.PrimaryKey!.Columns);

            await Fixture.Designer.AlterAsync(
                session,
                new TableAlteration
                {
                    Table = target,
                    DroppedPrimaryKeyName = before.PrimaryKey.Name,
                    NewPrimaryKey = new PrimaryKeyDefinition
                    {
                        Name = Fixture.Stored($"pk_{table}"),
                        Columns = ["id", "codigo"],
                    },
                },
                CancellationToken.None);

            var after = await Fixture.Metadata.GetTableStructureAsync(
                session,
                target,
                CancellationToken.None);

            Assert.NotNull(after.PrimaryKey);
            Assert.Equal(
                [Fixture.Stored("id"), Fixture.Stored("codigo")],
                after.PrimaryKey!.Columns);
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    /// <summary>
    /// Añade una clave foránea a una tabla que ya existe, y la quita.
    ///
    /// Crear la tabla con su foránea ya se prueba; añadirla después es otro
    /// camino —un `ALTER` en lugar de un `CREATE`— y es el que usa quien relaciona
    /// dos tablas que ya tenían datos.
    /// </summary>
    [Fact]
    public async Task AnadeYQuitaUnaClaveForanea()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var parent = Fixture.Stored($"druse_fkp_{suffix}");
        var child = Fixture.Stored($"druse_fkh_{suffix}");

        var target = new DatabaseObject
        {
            Id = child,
            Name = child,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = parent,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                        },
                    ],
                },
                CancellationToken.None);

            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = child,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                        },
                        new TableColumnDefinition { Name = "padre_id", DataType = "INTEGER" },
                    ],
                },
                CancellationToken.None);

            await Fixture.Designer.AlterAsync(
                session,
                new TableAlteration
                {
                    Table = target,
                    AddedForeignKeys =
                    [
                        new ForeignKeyDefinition
                        {
                            Name = Fixture.Stored($"fk_{child}"),
                            Columns = ["padre_id"],
                            ReferencedSchema = Fixture.DefaultSchema,
                            ReferencedTable = parent,
                            ReferencedColumns = ["id"],
                        },
                    ],
                },
                CancellationToken.None);

            var structure = await Fixture.Metadata.GetTableStructureAsync(
                session,
                target,
                CancellationToken.None);

            var foreign = Assert.Single(structure.ForeignKeys);

            Assert.Equal(Fixture.Stored("padre_id"), Assert.Single(foreign.Columns), ignoreCase: true);
            Assert.Equal(parent, foreign.ReferencedTable, ignoreCase: true);

            // Las columnas referenciadas se comprueban **si el motor las
            // entrega**: el catálogo de Informix no las da junto a la clave, y
            // sacarlas costaría una consulta por cada foránea sobre una conexión
            // que no admite dos a la vez. Está decidido y escrito en su lector.
            if (foreign.ReferencedColumns.Count > 0)
            {
                Assert.Equal("id", Assert.Single(foreign.ReferencedColumns), ignoreCase: true);
            }

            // Y al quitarla desaparece: leer después de borrar es lo que distingue
            // un borrado real de una instrucción que no hizo nada.
            await Fixture.Designer.AlterAsync(
                session,
                new TableAlteration
                {
                    Table = target,
                    DroppedForeignKeys = [foreign.Name],
                },
                CancellationToken.None);

            var after = await Fixture.Metadata.GetTableStructureAsync(
                session,
                target,
                CancellationToken.None);

            Assert.Empty(after.ForeignKeys);
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(child));
            await ExecuteAsync(session, Fixture.DropTable(parent));
        }
    }

    /// <summary>
    /// Crea índices y restricciones con el diseñador y los vuelve a leer del
    /// catálogo.
    ///
    /// Las dos mitades se comprueban juntas a propósito: un DDL correcto que el
    /// lector no sabe interpretar deja la pantalla en blanco, y un lector
    /// correcto sobre un DDL que el motor rechaza no llega a ejecutarse. Solo el
    /// ciclo completo demuestra que encajan.
    /// </summary>
    [Fact]
    public async Task CreaIndicesYRestriccionesYLosVuelveALeer()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_tmp_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateTableWithColumns(table));

            var target = new DatabaseObject
            {
                Id = table,
                Name = table,
                Kind = DatabaseObjectKind.Table,
                Database = Fixture.DatabaseName,
                Schema = Fixture.DefaultSchema,
            };

            var alteration = new TableAlteration
            {
                Table = target,
                AddedIndexes =
                [
                    new IndexDefinition
                    {
                        Name = Fixture.Stored($"ix_{table}"),
                        Columns = [new IndexColumn { Name = "id", Direction = IndexSortDirection.Descending }],
                    },
                ],
                // La restricción va sobre `nombre` y no sobre `id`: MySQL
                // rechaza cualquier CHECK que mencione una columna
                // AUTO_INCREMENT, así que comprobarlo ahí mediría una
                // limitación del motor en vez del ciclo que interesa.
                AddedCheckConstraints = Fixture.Designer.IndexCapabilities.SupportsCheckConstraints
                    ?
                    [
                        new CheckConstraintDefinition
                        {
                            Name = Fixture.Stored($"ck_{table}"),
                            Expression = "nombre <> ''",
                        },
                    ]
                    : [],
            };

            await Fixture.Designer.AlterAsync(session, alteration, CancellationToken.None);

            var structure = await Fixture.Metadata.GetTableStructureAsync(
                session,
                target,
                CancellationToken.None);

            var index = Assert.Single(structure.Indexes, item => item.Name == Fixture.Stored($"ix_{table}"));

            Assert.Equal(Fixture.Stored("id"), Assert.Single(index.Columns).Name);
            Assert.False(index.IsPrimaryKey);
            Assert.False(index.IsConstraintIndex);

            // La clave primaria de la tabla llega como tal, y su índice queda
            // marcado para que la interfaz no ofrezca borrarlo suelto. Donde no
            // hay índice que marcar —una clave de enteros en SQLite **es** el
            // `rowid`— no hay nada que ofrecer, y eso se declara.
            Assert.NotNull(structure.PrimaryKey);
            Assert.Contains(Fixture.Stored("id"), structure.PrimaryKey!.Columns);

            if (Fixture.PublishesPrimaryKeyIndex)
            {
                Assert.Contains(structure.Indexes, item => item.IsPrimaryKey && item.IsConstraintIndex);
            }

            if (Fixture.Designer.IndexCapabilities.SupportsCheckConstraints)
            {
                Assert.Contains(structure.CheckConstraints, item => item.Name == Fixture.Stored($"ck_{table}"));
            }

            // Y al quitarlo, desaparece: leer después de borrar es lo que
            // distingue un borrado real de una instrucción que no hizo nada.
            await Fixture.Designer.AlterAsync(
                session,
                new TableAlteration { Table = target, DroppedIndexes = [Fixture.Stored($"ix_{table}")] },
                CancellationToken.None);

            var after = await Fixture.Metadata.GetTableStructureAsync(
                session,
                target,
                CancellationToken.None);

            Assert.DoesNotContain(after.Indexes, item => item.Name == Fixture.Stored($"ix_{table}"));
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    /// <summary>
    /// Aplicar una instrucción del artefacto, que es lo que hace restaurar.
    ///
    /// El camino de la restauración no es el del editor de consultas: no analiza
    /// riesgo, no trae filas y no arma un resultado, porque lo que ejecuta son
    /// treinta mil instrucciones seguidas escritas por Druse. Aquí se comprueba
    /// lo único que promete —que se aplica y que dice cuántas filas tocó— en los
    /// cuatro motores, porque de ese recuento vive el progreso.
    /// </summary>
    [Fact]
    public async Task AplicaUnaInstrucciónDelArtefactoYCuentaSusFilas()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_apl_{Guid.NewGuid().ToString("N")[..8]}");

        try
        {
            // Un `CREATE TABLE` no escribe filas: cero, y no el -1 que devuelven
            // casi todos los proveedores por dentro.
            var created = await Fixture.Scripter.ApplyAsync(
                session,
                Fixture.CreateTable(table),
                CancellationToken.None);

            Assert.Equal(0, created);

            var inserted = await Fixture.Scripter.ApplyAsync(
                session,
                Fixture.InsertThreeRows(table),
                CancellationToken.None);

            Assert.Equal(3, inserted);

            var result = await ExecuteAsync(session, $"SELECT COUNT(*) FROM {table}");

            Assert.Equal("3", result.ResultSets[0].Rows[0][0]);
        }
        finally
        {
            await CleanAsync(session, Fixture.DropTable(table));
        }
    }

    /// <summary>
    /// El guion crea el esquema donde viven las tablas, y aplicarlo dos veces no
    /// falla.
    ///
    /// Es lo que separa un respaldo que se puede aplicar de uno que no: el caso
    /// que justifica la función es llevarse la estructura a una base **recién
    /// creada**, donde el esquema todavía no existe, y sin esto el artefacto
    /// muere en su primer `CREATE TABLE`. Se descubrió probándolo a mano contra
    /// PostgreSQL, no en una prueba.
    ///
    /// Se aplica dos veces a propósito: sobre una base que ya tiene el esquema,
    /// un `CREATE SCHEMA` sin condición dejaría el respaldo inservible justo en
    /// el caso más común, que es restaurar encima de lo de ayer.
    /// </summary>
    [Fact]
    public async Task ElGuionCreaElEsquemaYSePuedeAplicarDosVeces()
    {
        if (Skip) { return; }

        var schema = Fixture.Stored($"druse_esq_{Guid.NewGuid().ToString("N")[..8]}");
        var script = Fixture.Scripter.ScriptSchema(schema);

        if (script.Count == 0)
        {
            // MySQL e Informix no crean nada: allí el esquema no es un objeto
            // aparte de la base, y quien restaura ya está conectado a una.
            // Escribir un `CREATE DATABASE` decidiría por él adónde va todo.
            Assert.Empty(Fixture.Scripter.ScriptSchema(Fixture.DefaultSchema));
            return;
        }

        await using var session = await OpenAsync();

        var table = $"{schema}.druse_t";

        try
        {
            foreach (var statement in script)
            {
                await ExecuteAsync(session, statement);
            }

            // Otra vez, ahora con el esquema ya creado.
            foreach (var statement in script)
            {
                await ExecuteAsync(session, statement);
            }

            // Y existe de verdad, no solo «no falló»: dentro cabe una tabla.
            await ExecuteAsync(session, Fixture.CreateTable(table));
        }
        finally
        {
            await CleanAsync(session, Fixture.DropTable(table));
            await CleanAsync(session, $"DROP SCHEMA {schema}");
        }
    }

    /// <summary>Limpieza que no tapa el fallo de la prueba con uno suyo.</summary>
    private async Task CleanAsync(IDatabaseSession session, string sql)
    {
        try
        {
            await ExecuteAsync(session, sql);
        }
        catch (Exception error) when (error is not OperationCanceledException)
        {
            // Si la prueba ya falló, lo que importa es su fallo y no este.
        }
    }

    /// <summary>
    /// Respalda la estructura de una tabla, la borra y la vuelve a crear desde el
    /// guion.
    ///
    /// **Es el criterio de salida de la Fase A de los respaldos**, y comprueba lo
    /// único que importa: que lo guionizado *sirva*. Comparar el SQL generado con
    /// un texto esperado diría que el generador no ha cambiado, que es otra cosa;
    /// un guion puede leerse perfecto y no ejecutarse, o ejecutarse y dejar una
    /// tabla distinta de la que se copió.
    ///
    /// Por eso el ciclo es entero —leer, guionizar, borrar, recrear, releer— y la
    /// comparación se hace **entre dos lecturas del catálogo**, no contra literales
    /// escritos a mano: así ningún motor necesita su propia expectativa.
    ///
    /// La tabla original se borra a propósito antes de recrearla. Es lo que hace
    /// una restauración de verdad, y además evita que los nombres de índices y
    /// restricciones choquen: en PostgreSQL viven en el esquema, no en la tabla.
    /// </summary>
    [Fact]
    public async Task RespaldaLaEstructuraDeUnaTablaYLaVuelveACrear()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var parent = Fixture.Stored($"druse_pad_{suffix}");
        var child = Fixture.Stored($"druse_hij_{suffix}");

        var target = new DatabaseObject
        {
            Id = child,
            Name = child,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            // La tabla de origen se crea con el diseñador y no con SQL del
            // fixture: así la prueba no añade una dependencia de dialecto por cada
            // cosa que quiere ver copiada.
            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = parent,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                        },
                    ],
                },
                CancellationToken.None);

            var design = new TableDefinition
            {
                Database = Fixture.DatabaseName,
                Schema = Fixture.DefaultSchema,
                Name = child,
                Columns =
                [
                    new TableColumnDefinition
                    {
                        Name = "id",
                        DataType = "INTEGER",
                        IsNullable = false,
                        IsPrimaryKey = true,
                        IsIdentity = true,
                    },
                    new TableColumnDefinition
                    {
                        Name = "codigo",
                        DataType = "VARCHAR(50)",
                        IsNullable = false,
                    },
                    new TableColumnDefinition
                    {
                        Name = "total",
                        DataType = "DECIMAL(12,2)",
                        IsNullable = false,
                        DefaultValue = "0",
                    },
                    new TableColumnDefinition { Name = "padre_id", DataType = "INTEGER" },
                ],
                UniqueConstraints =
                [
                    new UniqueConstraintDefinition
                    {
                        Name = Fixture.Stored($"uq_{child}"),
                        Columns = ["codigo"],
                    },
                ],
                // Sobre `codigo` y no sobre `id`: MySQL rechaza cualquier CHECK
                // que mencione una columna AUTO_INCREMENT.
                CheckConstraints = Fixture.Designer.IndexCapabilities.SupportsCheckConstraints
                    ?
                    [
                        new CheckConstraintDefinition
                        {
                            Name = Fixture.Stored($"ck_{child}"),
                            Expression = "codigo <> ''",
                        },
                    ]
                    : [],
                ForeignKeys =
                [
                    new ForeignKeyDefinition
                    {
                        Name = Fixture.Stored($"fk_{child}"),
                        Columns = ["padre_id"],
                        ReferencedSchema = Fixture.DefaultSchema,
                        ReferencedTable = parent,
                        ReferencedColumns = ["id"],
                    },
                ],
                Indexes =
                [
                    new IndexDefinition
                    {
                        Name = Fixture.Stored($"ix_{child}"),
                        Columns = [new IndexColumn { Name = "total" }],
                    },
                ],
            };

            await Fixture.Designer.CreateAsync(session, design, CancellationToken.None);

            var before = new ScriptedTable
            {
                Table = target,
                Columns = await Fixture.Metadata.GetColumnsAsync(
                    session,
                    target,
                    CancellationToken.None),
                Structure = await Fixture.Metadata.GetTableStructureAsync(
                    session,
                    target,
                    CancellationToken.None),
            };

            // El guion se escribe **antes** de borrar: es el respaldo.
            var script = new List<string>();
            script.AddRange(Fixture.Scripter.ScriptTable(before));
            script.AddRange(Fixture.Scripter.ScriptIndexes(before));
            script.AddRange(Fixture.Scripter.ScriptForeignKeys(before));

            await ExecuteAsync(session, Fixture.DropTable(child));

            // Cuando el guion no se puede ejecutar, lo que hace falta saber es
            // **qué instrucción** falló y con qué texto exacto. Un motor que solo
            // dice «error de sintaxis» —Informix lo hace— deja el diagnóstico en
            // manos de esto.
            foreach (var statement in script)
            {
                QueryResult result;

                try
                {
                    result = await ExecuteAsync(session, statement);
                }
                catch (Exception error)
                {
                    throw new InvalidOperationException(
                        $"El guion no se pudo ejecutar en {Fixture.EngineName}." +
                        $"{Environment.NewLine}{statement}",
                        error);
                }

                Assert.True(
                    result.Error is null,
                    $"El guion no se pudo ejecutar en {Fixture.EngineName}: " +
                    $"{result.Error?.Message}{Environment.NewLine}{statement}");
            }

            var after = new ScriptedTable
            {
                Table = target,
                Columns = await Fixture.Metadata.GetColumnsAsync(
                    session,
                    target,
                    CancellationToken.None),
                Structure = await Fixture.Metadata.GetTableStructureAsync(
                    session,
                    target,
                    CancellationToken.None),
            };

            // --- Las columnas, en orden, con su tipo y su nulabilidad ----------
            Assert.Equal(
                before.Columns.Select(column => column.Name),
                after.Columns.Select(column => column.Name));

            foreach (var original in before.Columns)
            {
                var copy = Assert.Single(after.Columns, item => item.Name == original.Name);

                Assert.Equal(original.DataType, copy.DataType);
                Assert.Equal(original.IsNullable, copy.IsNullable);

                // Que la columna la rellene el motor es lo primero que se pierde al
                // reproducir una tabla, y no se nota hasta el primer `INSERT`.
                Assert.Equal(original.IsGenerated, copy.IsGenerated);
            }

            // --- La clave primaria --------------------------------------------
            Assert.NotNull(after.Structure.PrimaryKey);
            Assert.Equal(
                before.Structure.PrimaryKey!.Columns,
                after.Structure.PrimaryKey!.Columns);

            if (Fixture.Scripter.Capabilities.NamesPrimaryKey)
            {
                Assert.Equal(
                    before.Structure.PrimaryKey.Name,
                    after.Structure.PrimaryKey.Name);
            }

            // --- Índices, restricciones y claves foráneas ----------------------
            var index = Assert.Single(after.Structure.Indexes, item => item.Name == Fixture.Stored($"ix_{child}"));

            Assert.Equal(Fixture.Stored("total"), Assert.Single(index.Columns).Name);

            // De la unicidad importan las columnas, que se comparan siempre; el
            // nombre solo donde el motor deje leerlo. En Informix lo que se lee es
            // el del índice interno que la sostiene, distinto en cada creación.
            Assert.Equal(
                before.Structure.UniqueConstraints
                    .Select(item => string.Join(",", item.Columns))
                    .Order(),
                after.Structure.UniqueConstraints
                    .Select(item => string.Join(",", item.Columns))
                    .Order());

            if (Fixture.Scripter.Capabilities.NamesUniqueConstraints)
            {
                Assert.Contains(after.Structure.UniqueConstraints, item => item.Name == Fixture.Stored($"uq_{child}"));
            }

            if (Fixture.Designer.IndexCapabilities.SupportsCheckConstraints)
            {
                Assert.Contains(after.Structure.CheckConstraints, item => item.Name == Fixture.Stored($"ck_{child}"));
            }

            var sourceKey = Assert.Single(
                before.Structure.ForeignKeys,
                item => item.Name == Fixture.Stored($"fk_{child}"));

            var foreignKey = Assert.Single(
                after.Structure.ForeignKeys,
                item => item.Name == Fixture.Stored($"fk_{child}"));

            Assert.Equal(parent, foreignKey.ReferencedTable);
            Assert.Equal(Fixture.Stored("padre_id"), Assert.Single(foreignKey.Columns));

            // Las columnas referenciadas se comparan **entre las dos lecturas** y
            // no contra un literal: el catálogo de Informix no las entrega, y
            // exigir «id» mediría esa carencia en vez de la copia. Lo que importa
            // es que la clave recreada apunte a lo mismo que la original.
            Assert.Equal(sourceKey.ReferencedColumns, foreignKey.ReferencedColumns);
        }
        finally
        {
            // El hijo primero: mientras exista su clave foránea, el padre no se
            // puede borrar.
            await ExecuteAsync(session, Fixture.DropTable(child));
            await ExecuteAsync(session, Fixture.DropTable(parent));
        }
    }

    /// <summary>
    /// Respalda los datos de una tabla con una columna de cada tipo, los borra y
    /// los vuelve a cargar desde el guion.
    ///
    /// **Es el criterio de salida de la Fase B**, y mide lo único que importa: que
    /// cada valor vuelva **igual**. Un literal mal escrito no da un error bonito;
    /// da un respaldo que se ejecuta entero y guarda otra cosa, y eso solo se ve
    /// comparando lo leído antes con lo leído después.
    ///
    /// Los valores se insertan con el mismo formateador que después los escribe.
    /// Eso no comprueba el formateador contra una verdad externa —para eso están
    /// las unitarias, valor a valor— pero sí lo que aquí interesa: que lo escrito
    /// se pueda ejecutar y que el ciclo leer, escribir y volver a leer no pierda
    /// nada.
    /// </summary>
    [Fact]
    public async Task RespaldaLosDatosDeUnaTablaYLosVuelveACargar()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var name = Fixture.Stored($"druse_dat_{Guid.NewGuid().ToString("N")[..8]}");
        var families = Fixture.TypesByFamily.Keys.Order().ToList();

        var target = new DatabaseObject
        {
            Id = name,
            Name = name,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = name,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                            IsIdentity = true,
                        },
                        .. families.Select(family => new TableColumnDefinition
                        {
                            Name = ColumnOf(family),
                            DataType = Fixture.TypesByFamily[family],
                        }),
                    ],
                },
                CancellationToken.None);

            var table = await ReadAsync(session, target);
            var columns = table.Columns
                .Where(column => column.Name != Fixture.Stored("id"))
                .OrderBy(column => column.Ordinal)
                .ToList();

            // De cómo se clasifique el tipo depende cómo se escribe el literal:
            // un booleano escrito como número lo rechaza el motor, y una fecha
            // escrita sin comillas también. Si el catálogo devuelve un nombre que
            // Druse no sabe clasificar, el respaldo saldría mal sin que nada más
            // lo delatara.
            foreach (var column in columns)
            {
                var expected = FamilyOf(column.Name);
                var actual = ColumnValueParser.Classify(column.DataType);

                Assert.True(
                    expected == actual,
                    $"{Fixture.EngineName} devuelve «{column.DataType}» para la columna " +
                    $"{column.Name}, que Druse clasifica como {actual} y no como {expected}.");
            }

            // Dos filas: una con un valor de cada tipo y otra entera a nulo. El
            // nulo es la mitad del trabajo de un respaldo y la que más se olvida.
            var names = string.Join(", ", columns.Select(column => column.Name));

            var values = string.Join(
                ", ",
                columns.Select(column =>
                    Fixture.Scripter.FormatLiteral(ValueOf(FamilyOf(column.Name)), column)));

            var nulls = string.Join(", ", columns.Select(_ => "NULL"));

            await ExecuteAsync(session, $"INSERT INTO {name} ({names}) VALUES ({values})");
            await ExecuteAsync(session, $"INSERT INTO {name} ({names}) VALUES ({nulls})");

            var before = await RowsAsync(session, name, names);

            Assert.Equal(2, before.Count);

            // --- El respaldo --------------------------------------------------
            var script = new List<string>(Fixture.Scripter.BeginDataLoad(table));

            await foreach (var statement in Fixture.Scripter.ScriptDataAsync(
                session,
                table,
                TableDataFilter.None,
                snapshot: null,
                CancellationToken.None))
            {
                script.Add(statement.Sql);
            }

            script.AddRange(Fixture.Scripter.EndDataLoad(table));

            // El identificador entra en el respaldo, así que la carga tiene que
            // poder escribir en una columna que genera el motor.
            Assert.Contains(script, statement => statement.Contains("INSERT INTO", StringComparison.Ordinal));

            await ExecuteAsync(session, $"DELETE FROM {name}");
            Assert.Empty(await RowsAsync(session, name, names));

            await RunAsync(session, script);

            var after = await RowsAsync(session, name, names);

            // --- Lo que tiene que salir igual ---------------------------------
            Assert.Equal(before.Count, after.Count);

            for (var row = 0; row < before.Count; row++)
            {
                Assert.Equal(before[row], after[row]);
            }
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(name));
        }
    }

    /// <summary>
    /// Las filas leídas como texto vuelven a entrar en su tabla y salen iguales.
    ///
    /// Es el camino de los datos en CSV, que no pasa por ningún `INSERT` escrito:
    /// el respaldo guarda lo que el motor devuelve como texto y la restauración lo
    /// vuelve a meter emparejando por nombre, convirtiendo cada celda al tipo de su
    /// columna y escribiendo con parámetros.
    ///
    /// Por eso se prueba con una columna de cada familia y con una fila entera a
    /// nulo: lo que se puede perder en ese viaje es justo lo que solo tiene texto
    /// —un `0x1AFF` que vuelve como la cadena «0x1AFF», una fecha que vuelve como
    /// otra fecha, un nulo que vuelve como cadena vacía— y ninguna de esas tres
    /// cosas da un error; dan una tabla con otro contenido.
    /// </summary>
    [Fact]
    public async Task CargaComoTextoLasFilasQueLeyoComoTexto()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var name = Fixture.Stored($"druse_csv_{Guid.NewGuid().ToString("N")[..8]}");
        var families = Fixture.TypesByFamily.Keys.Order().ToList();

        var target = new DatabaseObject
        {
            Id = name,
            Name = name,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = name,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                            IsIdentity = true,
                        },
                        .. families.Select(family => new TableColumnDefinition
                        {
                            Name = ColumnOf(family),
                            DataType = Fixture.TypesByFamily[family],
                        }),
                    ],
                },
                CancellationToken.None);

            var table = await ReadAsync(session, target);
            var columns = table.Columns
                .Where(column => column.Name != Fixture.Stored("id"))
                .OrderBy(column => column.Ordinal)
                .ToList();

            var names = string.Join(", ", columns.Select(column => column.Name));

            var values = string.Join(
                ", ",
                columns.Select(column =>
                    Fixture.Scripter.FormatLiteral(ValueOf(FamilyOf(column.Name)), column)));

            var nulls = string.Join(", ", columns.Select(_ => "NULL"));

            await ExecuteAsync(session, $"INSERT INTO {name} ({names}) VALUES ({values})");
            await ExecuteAsync(session, $"INSERT INTO {name} ({names}) VALUES ({nulls})");

            // Esto es lo que acabaría dentro del CSV: lo que el motor devuelve.
            var before = await CellsAsync(session, name, names);

            Assert.Equal(2, before.Count);

            await ExecuteAsync(session, $"DELETE FROM {name}");

            // --- Y esto es la restauración de ese CSV -------------------------
            var plan = RowBatchPlanner.Prepare(
                Fixture.DefaultSchema,
                name,
                [.. columns.Select(column => (DatabaseColumn?)column)],
                before);

            Assert.True(
                plan.Problems.Count == 0,
                $"{Fixture.EngineName} devolvió valores que no se pueden volver a leer: " +
                string.Join(
                    "; ",
                    plan.Problems.Select(problem => $"{problem.Column}: {problem.Message}")));

            await Fixture.RowEditor.InsertAsync(session, plan.Batch, CancellationToken.None);

            var after = await CellsAsync(session, name, names);

            Assert.Equal(before.Count, after.Count);

            for (var row = 0; row < before.Count; row++)
            {
                Assert.Equal(before[row], after[row]);
            }
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(name));
        }
    }

    /// <summary>
    /// Lee un respaldo entero bajo una sola instantánea.
    ///
    /// Es lo que impide que la tabla de pedidos se lea a las 10:00 y la de líneas a
    /// las 10:04, produciendo un archivo que no corresponde a ningún momento real
    /// de la base. Se comprueba lo que se puede comprobar sin dos conexiones
    /// escribiendo a la vez: que se abre, que se lee dentro de ella y que **el
    /// motor dice si la concedió**, porque de eso depende lo que se escriba en el
    /// manifiesto.
    /// </summary>
    [Fact]
    public async Task ElRespaldoSeLeeBajoUnaInstantanea()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var name = Fixture.Stored($"druse_ins_{Guid.NewGuid().ToString("N")[..8]}");

        var target = new DatabaseObject
        {
            Id = name,
            Name = name,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            await ExecuteAsync(session, Fixture.CreateTableWithColumns(name));
            await ExecuteAsync(session, Fixture.InsertNamedRows(name));

            var table = await ReadAsync(session, target);

            await using var snapshot = await Fixture.Scripter.BeginSnapshotAsync(
                session,
                CancellationToken.None);

            var rows = new List<ScriptedRows>();

            await foreach (var statement in Fixture.Scripter.ScriptDataAsync(
                session,
                table,
                TableDataFilter.None,
                snapshot,
                CancellationToken.None))
            {
                rows.Add(statement);
            }

            Assert.Equal(3, rows.Sum(row => row.Rows));

            // Un motor que no la conceda no es un fallo: es un límite que el
            // respaldo declara. Lo que no vale es prometerla sin tenerla.
            Assert.True(
                snapshot.IsConsistent || snapshot.Transaction is null,
                $"{Fixture.EngineName} dice tener instantánea pero no abrió transacción.");
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(name));
        }
    }

    /// <summary>
    /// Los filtros: la condición, el tope de filas y las columnas que no se
    /// copian.
    ///
    /// Se comprueban sobre filas de verdad porque cada motor escribe el límite en
    /// un sitio distinto de la instrucción —`LIMIT` al final, `TOP` y `FIRST`
    /// delante de las columnas— y un límite mal colocado no falla: devuelve otra
    /// cosa.
    /// </summary>
    [Fact]
    public async Task LosFiltrosRecortanLoQueSeLleva()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var name = Fixture.Stored($"druse_fil_{Guid.NewGuid().ToString("N")[..8]}");

        var target = new DatabaseObject
        {
            Id = name,
            Name = name,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            await ExecuteAsync(session, Fixture.CreateTableWithColumns(name));
            await ExecuteAsync(session, Fixture.InsertNamedRows(name));

            var table = await ReadAsync(session, target);

            // --- Tope de filas -------------------------------------------------
            var limited = await ScriptAsync(session, table, new TableDataFilter { MaxRows = 2 });

            Assert.Equal(2, CountRows(limited));

            // --- Condición -----------------------------------------------------
            var filtered = await ScriptAsync(
                session,
                table,
                new TableDataFilter { Where = "id = 2" });

            var only = Assert.Single(filtered).Sql;

            Assert.Contains("Bea", only, StringComparison.Ordinal);
            Assert.DoesNotContain("Ana", only, StringComparison.Ordinal);

            // --- Columnas excluidas ---------------------------------------------
            var withoutName = await ScriptAsync(
                session,
                table,
                new TableDataFilter { ExcludedColumns = [Fixture.Stored("email")] });

            Assert.NotEmpty(withoutName);
            Assert.All(withoutName, statement =>
                Assert.DoesNotContain("email", statement.Sql, StringComparison.OrdinalIgnoreCase));

            // --- Y lo que no se admite ------------------------------------------
            // La condición acaba dentro de un `SELECT` que arma Druse, así que una
            // segunda instrucción se rechaza antes de llegar al motor.
            await Assert.ThrowsAsync<ArgumentException>(async () =>
                await ScriptAsync(
                    session,
                    table,
                    new TableDataFilter { Where = $"1=1; DROP TABLE {name}" }));

            // Y la tabla sigue ahí.
            Assert.Equal(3, (await RowsAsync(session, name, "id")).Count);
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(name));
        }
    }

    /// <summary>
    /// La lectura en lote la escribe **cada proveedor**.
    ///
    /// `IDatabaseMetadataReader` trae una implementación por defecto que recorre
    /// las tablas de una en una, y existe solo para que un proveedor nuevo
    /// arranque. Quedarse en ella funciona —devuelve lo mismo— pero convierte un
    /// diagrama de sesenta tablas en más de doscientos viajes contra una conexión
    /// que no admite dos cosas a la vez, y eso no se nota hasta que alguien abre
    /// un esquema grande.
    ///
    /// Contar los viajes de verdad exigiría instrumentar los cuatro drivers, que
    /// no comparten un punto por donde pasen todas sus consultas. Lo que sí se
    /// puede comprobar sin ambigüedad es que el proveedor declara el método: si
    /// no lo declara, se está quedando en la implementación base.
    /// </summary>
    [Fact]
    public void LaLecturaEnLoteLaEscribeCadaProveedor()
    {
        var declared = Fixture.Metadata.GetType().GetMethod(
            nameof(IDatabaseMetadataReader.GetTableDetailsAsync),
            [typeof(IDatabaseSession), typeof(IReadOnlyList<DatabaseObject>), typeof(CancellationToken)]);

        Assert.True(
            declared is not null,
            $"{Fixture.EngineName} no implementa GetTableDetailsAsync y se queda en la " +
            "implementación por defecto, que hace una lectura por tabla.");
    }

    /// <summary>
    /// Leer varias tablas de una vez devuelve exactamente lo mismo que leerlas
    /// una a una.
    ///
    /// Es la comprobación que importa: una consulta que abarca varias tablas se
    /// rompe siempre por el mismo sitio —los índices de una acaban colgando de
    /// otra—, y ese fallo no se ve mirando una sola tabla. Por eso hay tres: una
    /// con clave foránea, la que la recibe, y una suelta que no debe heredar
    /// nada.
    ///
    /// La cuarta que se pide **no existe**, y comprobar que no vuelve es lo que
    /// sostiene el aviso de la interfaz cuando un diagrama guardado nombra una
    /// tabla que alguien borró.
    /// </summary>
    [Fact]
    public async Task LeeVariasTablasDeUnaVez_YDevuelveLoMismoQueUnaAUna()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var suffix = Guid.NewGuid().ToString("N")[..8];
        var parent = Fixture.Stored($"druse_lote_p_{suffix}");
        var child = Fixture.Stored($"druse_lote_h_{suffix}");
        var alone = Fixture.Stored($"druse_lote_s_{suffix}");

        DatabaseObject Target(string name) => new()
        {
            Id = name,
            Name = name,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        try
        {
            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = parent,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                        },
                        new TableColumnDefinition { Name = "codigo", DataType = "VARCHAR(20)" },
                    ],
                },
                CancellationToken.None);

            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = child,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                        },
                        new TableColumnDefinition { Name = "padre_id", DataType = "INTEGER" },
                    ],
                },
                CancellationToken.None);

            await Fixture.Designer.CreateAsync(
                session,
                new TableDefinition
                {
                    Database = Fixture.DatabaseName,
                    Schema = Fixture.DefaultSchema,
                    Name = alone,
                    Columns =
                    [
                        new TableColumnDefinition
                        {
                            Name = "id",
                            DataType = "INTEGER",
                            IsNullable = false,
                            IsPrimaryKey = true,
                        },
                    ],
                },
                CancellationToken.None);

            await Fixture.Designer.AlterAsync(
                session,
                new TableAlteration
                {
                    Table = Target(child),
                    AddedForeignKeys =
                    [
                        new ForeignKeyDefinition
                        {
                            Name = Fixture.Stored($"fk_{child}"),
                            Columns = ["padre_id"],
                            ReferencedSchema = Fixture.DefaultSchema,
                            ReferencedTable = parent,
                            ReferencedColumns = ["id"],
                        },
                    ],
                },
                CancellationToken.None);

            var wanted = new[]
            {
                Target(parent),
                Target(child),
                Target(alone),
                Target($"druse_lote_x_{suffix}"),
            };

            var batch = await Fixture.Metadata.GetTableDetailsAsync(
                session,
                wanted,
                CancellationToken.None);

            // La que no existe no vuelve, y las otras tres sí, en el orden pedido.
            Assert.Equal(
                new[] { parent, child, alone },
                batch.Select(detail => detail.Table.Name));

            foreach (var table in wanted.Take(3))
            {
                var columns = await Fixture.Metadata.GetColumnsAsync(
                    session,
                    table,
                    CancellationToken.None);

                var structure = await Fixture.Metadata.GetTableStructureAsync(
                    session,
                    table,
                    CancellationToken.None);

                var detail = batch.Single(entry => entry.Table.Name == table.Name);

                Assert.Equal(
                    columns.Select(column => (column.Name, column.IsPrimaryKey, column.Ordinal)),
                    detail.Columns.Select(column => (column.Name, column.IsPrimaryKey, column.Ordinal)));

                Assert.Equal(
                    structure.PrimaryKey?.Columns ?? [],
                    detail.Structure.PrimaryKey?.Columns ?? []);

                Assert.Equal(
                    structure.ForeignKeys.Select(key => (key.Name, Columns: string.Join(",", key.Columns), key.ReferencedTable)),
                    detail.Structure.ForeignKeys.Select(key => (key.Name, Columns: string.Join(",", key.Columns), key.ReferencedTable)));

                Assert.Equal(
                    structure.Indexes.Select(index => index.Name).Order(StringComparer.Ordinal),
                    detail.Structure.Indexes.Select(index => index.Name).Order(StringComparer.Ordinal));

                Assert.Equal(
                    structure.UniqueConstraints.Select(unique => unique.Name).Order(StringComparer.Ordinal),
                    detail.Structure.UniqueConstraints.Select(unique => unique.Name).Order(StringComparer.Ordinal));
            }

            // Lo que la lectura conjunta puede romper: que lo de una tabla se
            // cuele en otra. La tabla suelta no tiene claves foráneas y la hija
            // tiene exactamente una.
            Assert.Empty(batch.Single(detail => detail.Table.Name == alone).Structure.ForeignKeys);
            Assert.Single(batch.Single(detail => detail.Table.Name == child).Structure.ForeignKeys);
            Assert.Empty(batch.Single(detail => detail.Table.Name == parent).Structure.ForeignKeys);
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(child));
            await ExecuteAsync(session, Fixture.DropTable(parent));
            await ExecuteAsync(session, Fixture.DropTable(alone));
        }
    }

    // -----------------------------------------------------------------------
    // Escribir sobre lo que ya está
    // -----------------------------------------------------------------------

    /// <summary>
    /// Insertar dos veces la misma fila falla, y no deja nada a medias.
    ///
    /// Es el comportamiento de siempre y sigue siendo el que se usa al importar:
    /// lo peor que puede hacer es negarse. Se comprueba junto a los otros dos
    /// modos porque lo que importa es que **los tres signifiquen lo mismo en los
    /// cuatro motores**, y eso solo se ve comparándolos.
    /// </summary>
    [Fact]
    public async Task InsertarLoQueYaEstaFallaYNoEscribeNada()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();
        var name = Fixture.Stored($"druse_up_{Guid.NewGuid().ToString("N")[..8]}");
        ScriptedTable? table = null;

        try
        {
            table = await PrepareUpsertTableAsync(session, name);

            var batch = await BatchAsync(session, name, [(2, "Beatriz"), (4, "Dora")]);

            await Assert.ThrowsAnyAsync<Exception>(
                () => Fixture.RowEditor.WriteAsync(
                    session,
                    batch,
                    ExistingRowAction.Fail,
                    [],
                    CancellationToken.None));

            // Ni siquiera la fila que no chocaba: es un lote, y un lote va entero.
            Assert.Equal(["1|Ana", "2|Bea", "3|Cris"], await RowsAsync(session, name, "id, nombre"));
        }
        finally
        {
            if (table is not null)
            {
                await CloseUpsertTableAsync(session, table);
            }

            await ExecuteAsync(session, Fixture.DropTable(name));
        }
    }

    /// <summary>
    /// Omitir lo que ya está: entra lo que falta, lo demás se queda como estaba y
    /// **se cuenta aparte**.
    ///
    /// El recuento es la mitad del valor del modo. Sin él, «entraron 900 de 5.000»
    /// parece que se perdieron cuatro mil filas por el camino.
    /// </summary>
    [Fact]
    public async Task OmitirLoQueYaEstaDejaLaFilaIntactaYLaCuenta()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();
        var name = Fixture.Stored($"druse_up_{Guid.NewGuid().ToString("N")[..8]}");
        ScriptedTable? table = null;

        try
        {
            table = await PrepareUpsertTableAsync(session, name);

            var result = await Fixture.RowEditor.WriteAsync(
                session,
                await BatchAsync(session, name, [(2, "Beatriz"), (4, "Dora")]),
                ExistingRowAction.Skip,
                ["id"],
                CancellationToken.None);

            Assert.Equal(1, result.RowsAffected);
            Assert.Equal(1, result.RowsSkipped);

            Assert.Equal(
                ["1|Ana", "2|Bea", "3|Cris", "4|Dora"],
                await RowsAsync(session, name, "id, nombre"));
        }
        finally
        {
            if (table is not null)
            {
                await CloseUpsertTableAsync(session, table);
            }

            await ExecuteAsync(session, Fixture.DropTable(name));
        }
    }

    /// <summary>
    /// Actualizar lo que ya está: la fila cambia y **no se duplica**.
    ///
    /// El recuento se normaliza aquí: MySQL devuelve dos filas afectadas cuando
    /// actualiza una, así que sin normalizar el mismo trabajo daría un número
    /// distinto según el motor.
    /// </summary>
    [Fact]
    public async Task ActualizarLoQueYaEstaCambiaLaFilaSinDuplicarla()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();
        var name = Fixture.Stored($"druse_up_{Guid.NewGuid().ToString("N")[..8]}");
        ScriptedTable? table = null;

        try
        {
            table = await PrepareUpsertTableAsync(session, name);

            var result = await Fixture.RowEditor.WriteAsync(
                session,
                await BatchAsync(session, name, [(2, "Beatriz"), (4, "Dora")]),
                ExistingRowAction.Update,
                ["id"],
                CancellationToken.None);

            Assert.Equal(2, result.RowsAffected);
            Assert.Equal(0, result.RowsSkipped);

            Assert.Equal(
                ["1|Ana", "2|Beatriz", "3|Cris", "4|Dora"],
                await RowsAsync(session, name, "id, nombre"));
        }
        finally
        {
            if (table is not null)
            {
                await CloseUpsertTableAsync(session, table);
            }

            await ExecuteAsync(session, Fixture.DropTable(name));
        }
    }

    /// <summary>
    /// Repetir el mismo traslado dos veces deja la tabla igual que una.
    ///
    /// Es la propiedad que hace útil el modo —se puede reanudar una copia que se
    /// cortó sin mirar por dónde iba— y la que se rompería si algún motor
    /// insertara en lugar de actualizar.
    /// </summary>
    [Fact]
    public async Task ActualizarDosVecesDejaLoMismoQueUna()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();
        var name = Fixture.Stored($"druse_up_{Guid.NewGuid().ToString("N")[..8]}");
        ScriptedTable? table = null;

        try
        {
            table = await PrepareUpsertTableAsync(session, name);

            for (var vuelta = 0; vuelta < 2; vuelta++)
            {
                await Fixture.RowEditor.WriteAsync(
                    session,
                    await BatchAsync(session, name, [(2, "Beatriz"), (4, "Dora")]),
                    ExistingRowAction.Update,
                    ["id"],
                    CancellationToken.None);
            }

            Assert.Equal(
                ["1|Ana", "2|Beatriz", "3|Cris", "4|Dora"],
                await RowsAsync(session, name, "id, nombre"));
        }
        finally
        {
            if (table is not null)
            {
                await CloseUpsertTableAsync(session, table);
            }

            await ExecuteAsync(session, Fixture.DropTable(name));
        }
    }

    /// <summary>
    /// Sin columnas que identifiquen la fila no se escribe nada.
    ///
    /// Se rechaza al armar la instrucción y no al ejecutarla: para entonces el
    /// mensaje sería del servidor y no diría qué se pretendía.
    /// </summary>
    [Fact]
    public async Task SinClaveNoSePuedeDecidirQueHacerConLoQueYaEsta()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();
        var name = Fixture.Stored($"druse_up_{Guid.NewGuid().ToString("N")[..8]}");
        ScriptedTable? table = null;

        try
        {
            table = await PrepareUpsertTableAsync(session, name);

            var batch = await BatchAsync(session, name, [(4, "Dora")]);

            await Assert.ThrowsAsync<ArgumentException>(
                () => Fixture.RowEditor.WriteAsync(
                    session,
                    batch,
                    ExistingRowAction.Update,
                    [],
                    CancellationToken.None));
        }
        finally
        {
            if (table is not null)
            {
                await CloseUpsertTableAsync(session, table);
            }

            await ExecuteAsync(session, Fixture.DropTable(name));
        }
    }

    /// <summary>Las dos columnas con las que se prueba escribir sobre lo que ya está.</summary>
    private static readonly string[] UpsertColumns = ["id", "nombre"];

    /// <summary>
    /// Deja la tabla con tres filas —1 Ana, 2 Bea y 3 Cris— y la identidad abierta.
    ///
    /// Lo segundo hace falta porque el `id` lo genera el motor y aquí se escriben
    /// valores propios, que es exactamente lo que hace un traslado al conservar los
    /// identificadores del origen. SQL Server lo rechaza sin abrirla antes, y de
    /// paso queda comprobado que lo que abre el guionizado sirve para lo que
    /// escribe el editor de filas.
    /// </summary>
    private async Task<ScriptedTable> PrepareUpsertTableAsync(IDatabaseSession session, string name)
    {
        await ExecuteAsync(session, Fixture.CreateTableWithColumns(name));
        await ExecuteAsync(session, Fixture.InsertNamedRows(name));

        var table = await ReadAsync(session, new DatabaseObject
        {
            Id = name,
            Name = name,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        });

        foreach (var statement in Fixture.Scripter.BeginDataLoad(table))
        {
            await ExecuteAsync(session, statement);
        }

        return table;
    }

    /// <summary>Cierra lo que abrió <see cref="PrepareUpsertTableAsync"/>.</summary>
    private async Task CloseUpsertTableAsync(IDatabaseSession session, ScriptedTable table)
    {
        foreach (var statement in Fixture.Scripter.EndDataLoad(table))
        {
            await ExecuteAsync(session, statement);
        }
    }

    /// <summary>
    /// Un lote con las columnas `id` y `nombre`, convertido como lo haría el
    /// traslado.
    ///
    /// Pasa por <see cref="RowBatchPlanner"/> a propósito: es el mismo camino que
    /// recorren los datos de verdad, y con él van los tipos que cada motor
    /// necesita para los nulos.
    /// </summary>
    private async Task<PreparedInsertBatch> BatchAsync(
        IDatabaseSession session,
        string name,
        IReadOnlyList<(int Id, string Nombre)> rows)
    {
        var target = new DatabaseObject
        {
            Id = name,
            Name = name,
            Kind = DatabaseObjectKind.Table,
            Database = Fixture.DatabaseName,
            Schema = Fixture.DefaultSchema,
        };

        var columns = await Fixture.Metadata.GetColumnsAsync(session, target, CancellationToken.None);

        var wanted = UpsertColumns
            .Select(wantedName => columns.First(column =>
                string.Equals(column.Name, wantedName, StringComparison.OrdinalIgnoreCase)))
            .ToList();

        var plan = RowBatchPlanner.Prepare(
            Fixture.DefaultSchema,
            name,
            [.. wanted.Select(column => (DatabaseColumn?)column)],
            [
                .. rows.Select(row => (IReadOnlyList<string?>)
                [
                    row.Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
                    row.Nombre,
                ]),
            ]);

        Assert.Empty(plan.Problems);

        return plan.Batch;
    }

    /// <summary>La tabla leída del catálogo, tal y como la recibe el guionizador.</summary>
    private async Task<ScriptedTable> ReadAsync(IDatabaseSession session, DatabaseObject table) => new()
    {
        Table = table,
        Columns = await Fixture.Metadata.GetColumnsAsync(session, table, CancellationToken.None),
        Structure = await Fixture.Metadata.GetTableStructureAsync(session, table, CancellationToken.None),
    };

    private async Task<List<ScriptedRows>> ScriptAsync(
        IDatabaseSession session,
        ScriptedTable table,
        TableDataFilter filter)
    {
        var statements = new List<ScriptedRows>();

        await foreach (var statement in Fixture.Scripter.ScriptDataAsync(
            session,
            table,
            filter,
            snapshot: null,
            CancellationToken.None))
        {
            statements.Add(statement);
        }

        return statements;
    }

    /// <summary>
    /// Cuántas filas hay en un guion, que no es lo mismo que cuántas
    /// instrucciones: donde el motor lo admite, varias filas van en un solo
    /// `INSERT`. El recuento lo trae cada instrucción, en vez de deducirse de su
    /// texto.
    /// </summary>
    private static int CountRows(IEnumerable<ScriptedRows> statements) =>
        statements.Sum(statement => statement.Rows);

    private async Task RunAsync(IDatabaseSession session, IEnumerable<string> statements)
    {
        foreach (var statement in statements)
        {
            QueryResult result;

            try
            {
                result = await ExecuteAsync(session, statement);
            }
            catch (Exception error)
            {
                throw new InvalidOperationException(
                    $"El guion no se pudo ejecutar en {Fixture.EngineName}." +
                    $"{Environment.NewLine}{statement}",
                    error);
            }

            Assert.True(
                result.Error is null,
                $"El guion no se pudo ejecutar en {Fixture.EngineName}: " +
                $"{result.Error?.Message}{Environment.NewLine}{statement}");
        }
    }

    /// <summary>
    /// Las filas de una tabla celda a celda, que es como acabarían en un CSV.
    ///
    /// Aparte de <see cref="RowsAsync"/> porque aquí no se comparan: se vuelven a
    /// meter, y para eso hacen falta las celdas sueltas y no una línea.
    /// </summary>
    private async Task<List<IReadOnlyList<string?>>> CellsAsync(
        IDatabaseSession session,
        string table,
        string columns)
    {
        var result = await ExecuteAsync(session, $"SELECT {columns} FROM {table} ORDER BY id");

        return
        [
            .. Assert.Single(result.ResultSets).Rows
                .Select(row => (IReadOnlyList<string?>)[.. row]),
        ];
    }

    /// <summary>Las filas de una tabla, como texto, para poder compararlas.</summary>
    private async Task<List<string>> RowsAsync(
        IDatabaseSession session,
        string table,
        string columns)
    {
        var result = await ExecuteAsync(session, $"SELECT {columns} FROM {table} ORDER BY id");
        var rows = Assert.Single(result.ResultSets).Rows;

        return [.. rows.Select(row => string.Join("|", row.Select(cell => cell ?? "<nulo>")))];
    }

    private static string ColumnOf(ColumnFamily family) =>
        $"c_{family.ToString().ToLowerInvariant()}";

    private static ColumnFamily FamilyOf(string column) =>
        Enum.Parse<ColumnFamily>(column[2..], ignoreCase: true);

    /// <summary>Un valor reconocible de cada familia, con lo que suele romperse.</summary>
    private static object ValueOf(ColumnFamily family) => family switch
    {
        // Comilla y barra invertida: lo que convierte una fila en instrucción si
        // el literal está mal escrito.
        ColumnFamily.Text => @"Ana O'Brien \ y punto",
        ColumnFamily.Integral => 42,
        ColumnFamily.Fractional => 3.50m,
        ColumnFamily.Boolean => true,
        ColumnFamily.Date => new DateOnly(2026, 8, 17),
        ColumnFamily.Timestamp => new DateTime(2026, 8, 17, 14, 3, 11, DateTimeKind.Unspecified),
        ColumnFamily.Binary => new byte[] { 0x00, 0x1A, 0xFF },
        _ => throw new NotSupportedException($"La prueba no sabe qué valor usar para {family}."),
    };

    /// <summary>
    /// Lee los parámetros de un procedimiento para poder componer su llamada.
    ///
    /// Lo que se comprueba es el orden y la dirección, no los nombres: SQL Server
    /// los adorna con `@` y ese adorno forma parte del nombre en la llamada, así
    /// que exigir un nombre común obligaría a normalizar algo que después hace
    /// falta tal cual.
    /// </summary>
    [Fact]
    public async Task LeeLosParametrosDeUnProcedimiento()
    {
        if (Skip || !Fixture.HasRoutines) { return; }

        await using var session = await OpenAsync();

        var procedureName = Fixture.Stored($"druse_params_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateProcedureWithParameters(procedureName));

            var folder = new DatabaseObject
            {
                Id = $"folder:{Fixture.DefaultSchema}:procedures",
                Name = "Procedures",
                Kind = DatabaseObjectKind.Folder,
                Database = Fixture.DatabaseName,
                Schema = Fixture.DefaultSchema,
            };

            var procedures = await Fixture.Metadata.GetChildrenAsync(
                session,
                folder,
                CancellationToken.None);

            var procedure = Assert.Single(
                procedures,
                item => item.Name == procedureName
                    || item.Name.StartsWith($"{procedureName}(", StringComparison.Ordinal));

            var signature = await Fixture.Metadata.GetRoutineSignatureAsync(
                session,
                procedure,
                CancellationToken.None);

            Assert.False(signature.IsFunction);
            Assert.Equal(2, signature.Parameters.Count);

            var entrada = signature.Parameters[0];
            Assert.Equal(RoutineParameterDirection.Input, entrada.Direction);
            Assert.False(string.IsNullOrWhiteSpace(entrada.DataType));

            // La segunda sale. Si además admite entrada es cosa del motor —SQL
            // Server no distingue `OUT` de `INOUT`— y da igual para la llamada:
            // en los dos casos hace falta una variable donde recogerla.
            var salida = signature.Parameters[1];
            Assert.True(
                salida.Direction is RoutineParameterDirection.Output
                    or RoutineParameterDirection.InputOutput,
                $"El segundo parámetro debía salir y llegó como {salida.Direction}.");

            // El tipo llega tal como lo escribe el motor, que es lo que hace falta
            // para declarar la variable donde se recoge la salida. **No se exige
            // la longitud**: PostgreSQL descarta los modificadores de tipo en los
            // parámetros de una rutina y devuelve `character varying` a secas
            // aunque se haya declarado con 30.
            Assert.False(string.IsNullOrWhiteSpace(salida.DataType));

            Assert.Equal(1, entrada.Ordinal);
            Assert.Equal(2, salida.Ordinal);
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropProcedure(procedureName));
        }
    }

    [Fact]
    public async Task ObtieneLaDefinicionDeUnaVista()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var viewName = Fixture.Stored($"druse_view_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateView(viewName));

            var view = new DatabaseObject
            {
                Id = $"View:{Fixture.DefaultSchema}.{viewName}",
                Name = viewName,
                Kind = DatabaseObjectKind.View,
                Database = Fixture.DatabaseName,
                Schema = Fixture.DefaultSchema,
            };

            var definition = await Fixture.Metadata.GetDefinitionAsync(
                session,
                view,
                CancellationToken.None);

            Assert.Contains("CREATE", definition, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("VIEW", definition, StringComparison.OrdinalIgnoreCase);
            Assert.Contains(viewName, definition, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("valor", definition, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropView(viewName));
        }
    }

    [Fact]
    public async Task ObtieneLaDefinicionDeUnProcedimiento()
    {
        if (Skip || !Fixture.HasRoutines) { return; }

        await using var session = await OpenAsync();

        var procedureName = Fixture.Stored($"druse_procedure_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateProcedure(procedureName));

            var folder = new DatabaseObject
            {
                Id = $"folder:{Fixture.DefaultSchema}:procedures",
                Name = "Procedures",
                Kind = DatabaseObjectKind.Folder,
                Database = Fixture.DatabaseName,
                Schema = Fixture.DefaultSchema,
            };
            var procedures = await Fixture.Metadata.GetChildrenAsync(
                session,
                folder,
                CancellationToken.None);
            var procedure = Assert.Single(
                procedures,
                item => item.Name == procedureName
                    || item.Name.StartsWith($"{procedureName}(", StringComparison.Ordinal));

            var definition = await Fixture.Metadata.GetDefinitionAsync(
                session,
                procedure,
                CancellationToken.None);

            Assert.Contains("CREATE", definition, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("PROCEDURE", definition, StringComparison.OrdinalIgnoreCase);
            Assert.Contains(procedureName, definition, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("marca_procedimiento", definition, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropProcedure(procedureName));
        }
    }

    [Fact]
    public async Task UnaSegundaBaseAutorizada_SeListaYSePuedeRecorrer()
    {
        if (Skip || !Fixture.HasMultipleDatabases) { return; }

        var databaseName = Fixture.SecondaryDatabaseName;
        var schemaName = Fixture.DefaultSchemaFor(databaseName);
        var tableName = Fixture.Stored($"druse_multibase_{Guid.NewGuid():N}");
        var viewName = Fixture.Stored($"druse_multibase_view_{Guid.NewGuid():N}");

        await using var browser = await OpenAsync();
        await using var selected = await Fixture.Provider.OpenDatabaseSessionAsync(
            browser,
            databaseName,
            CancellationToken.None);

        try
        {
            Assert.Equal(
                QueryExecutionState.Succeeded,
                (await ExecuteAsync(selected, Fixture.CreateTableWithColumns(tableName))).State);
            Assert.Equal(
                QueryExecutionState.Succeeded,
                (await ExecuteAsync(selected, Fixture.CreateView(viewName))).State);

            var databases = await Fixture.Metadata.GetDatabasesAsync(
                browser,
                CancellationToken.None);
            var database = Assert.Single(databases, item => item.Name == databaseName);

            var schemas = await Fixture.Metadata.GetChildrenAsync(
                selected,
                database,
                CancellationToken.None);
            var schema = Assert.Single(schemas, item => item.Name == schemaName);
            Assert.Equal(databaseName, schema.Database);

            var folders = await Fixture.Metadata.GetChildrenAsync(
                selected,
                schema,
                CancellationToken.None);
            var tablesFolder = Assert.Single(folders, item => item.Name == "Tables");
            var viewsFolder = Assert.Single(folders, item => item.Name == "Views");

            var tables = await Fixture.Metadata.GetChildrenAsync(
                selected,
                tablesFolder,
                CancellationToken.None);
            var table = Assert.Single(tables, item => item.Name == tableName);
            Assert.Equal(databaseName, table.Database);

            var columns = await Fixture.Metadata.GetColumnsAsync(
                selected,
                table,
                CancellationToken.None);
            Assert.Equal(4, columns.Count);
            Assert.True(columns[0].IsPrimaryKey);

            var views = await Fixture.Metadata.GetChildrenAsync(
                selected,
                viewsFolder,
                CancellationToken.None);
            var view = Assert.Single(views, item => item.Name == viewName);
            var definition = await Fixture.Metadata.GetDefinitionAsync(
                selected,
                view,
                CancellationToken.None);

            Assert.Contains("VIEW", definition, StringComparison.OrdinalIgnoreCase);
            Assert.Contains(viewName, definition, StringComparison.OrdinalIgnoreCase);
            Assert.Contains("valor", definition, StringComparison.OrdinalIgnoreCase);
            Assert.True(browser.IsOpen);
        }
        finally
        {
            await ExecuteAsync(selected, Fixture.DropView(viewName));
            await ExecuteAsync(selected, Fixture.DropTable(tableName));
        }
    }

    // -----------------------------------------------------------------------
    // Edición de filas
    // -----------------------------------------------------------------------

    [Fact]
    public async Task BorrarUnaFila_QuitaEsaYSoloEsa()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_tmp_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateTableWithColumns(table));
            await ExecuteAsync(session, Fixture.InsertNamedRows(table));

            var batch = new PreparedRowDeleteBatch
            {
                Schema = Fixture.DefaultSchema,
                Table = table,
                Keys = [[new PreparedCell("id", 2L, "2")]],
            };

            var result = await Fixture.RowEditor.DeleteAsync(session, batch, CancellationToken.None);

            Assert.Equal(1, result.RowsAffected);

            var después = await ExecuteAsync(
                session,
                $"SELECT nombre FROM {Fixture.DefaultSchema}.{table} ORDER BY id");

            // Se fue la segunda y solo la segunda. Un borrado que se lleve de más
            // no se arregla después: no queda valor anterior que devolver.
            Assert.Equal(["Ana", "Cris"], después.ResultSets[0].Rows.Select(row => row[0]));
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    /// <summary>
    /// Una fila que ya no está deja el resto intacto y lo dice.
    ///
    /// Es el caso que de verdad protege la regla de «exactamente una fila»: dos
    /// personas mirando la misma cuadrícula, y una borra antes que la otra.
    /// </summary>
    [Fact]
    public async Task BorrarUnaFilaQueYaNoExiste_NoSeLlevaNadaMas()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_tmp_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateTableWithColumns(table));
            await ExecuteAsync(session, Fixture.InsertNamedRows(table));

            var batch = new PreparedRowDeleteBatch
            {
                Schema = Fixture.DefaultSchema,
                Table = table,
                Keys =
                [
                    [new PreparedCell("id", 1L, "1")],
                    [new PreparedCell("id", 99L, "99")],
                ],
            };

            await Assert.ThrowsAsync<RowEditFailedException>(
                () => Fixture.RowEditor.DeleteAsync(session, batch, CancellationToken.None));

            var después = await ExecuteAsync(
                session,
                $"SELECT nombre FROM {Fixture.DefaultSchema}.{table} ORDER BY id");

            // Ni siquiera la primera, que sí existía: o se borra todo lo pedido o
            // no se borra nada.
            Assert.Equal(["Ana", "Bea", "Cris"], después.ResultSets[0].Rows.Select(row => row[0]));
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    [Fact]
    public async Task EditarUnaFila_CambiaEsaYSoloEsa()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_tmp_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateTableWithColumns(table));
            await ExecuteAsync(session, Fixture.InsertNamedRows(table));

            var batch = new PreparedRowEditBatch
            {
                Schema = Fixture.DefaultSchema,
                Table = table,
                Edits =
                [
                    new PreparedRowEdit
                    {
                        Key = [new PreparedCell("id", 2L, "2")],
                        Changes = [new PreparedCell("nombre", "Cambiado", "'Cambiado'")],
                    },
                ],
            };

            var result = await Fixture.RowEditor.ApplyAsync(session, batch, CancellationToken.None);

            Assert.Equal(1, result.RowsAffected);

            var después = await ExecuteAsync(
                session,
                $"SELECT nombre FROM {Fixture.DefaultSchema}.{table} ORDER BY id");

            // La segunda cambió; las otras dos siguen como estaban. Un editor de
            // filas que toque de más es peor que no tener editor.
            Assert.Equal(["Ana", "Cambiado", "Cris"], después.ResultSets[0].Rows.Select(row => row[0]));
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    [Fact]
    public async Task ElSqlQueSeEnsena_EsElQueSeEjecuta()
    {
        if (Skip) { return; }

        var batch = new PreparedRowEditBatch
        {
            Schema = Fixture.DefaultSchema,
            Table = "usuarios",
            Edits =
            [
                new PreparedRowEdit
                {
                    Key = [new PreparedCell("id", 7L, "7")],
                    Changes = [new PreparedCell("nombre", "Ana", "'Ana'")],
                },
            ],
        };

        var sql = Assert.Single(Fixture.RowEditor.Describe(batch));

        // Se comprueba la forma, no el dialecto: cada motor cita a su manera.
        Assert.StartsWith("UPDATE ", sql, StringComparison.Ordinal);
        Assert.Contains(Fixture.Stored("usuarios"), sql, StringComparison.Ordinal);
        Assert.Contains("SET ", sql, StringComparison.Ordinal);
        Assert.Contains("'Ana'", sql, StringComparison.Ordinal);
        Assert.Contains("WHERE ", sql, StringComparison.Ordinal);
        Assert.Contains("7", sql, StringComparison.Ordinal);
    }

    [Fact]
    public async Task SiUnaFilaNoExiste_NoSeGuardaNadaDeLoDemas()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = Fixture.Stored($"druse_tmp_{Guid.NewGuid():N}");

        try
        {
            await ExecuteAsync(session, Fixture.CreateTableWithColumns(table));
            await ExecuteAsync(session, Fixture.InsertNamedRows(table));

            var batch = new PreparedRowEditBatch
            {
                Schema = Fixture.DefaultSchema,
                Table = table,
                Edits =
                [
                    // La primera es válida; la segunda apunta a una fila que no
                    // existe. Si la transacción no funciona, la primera se queda.
                    new PreparedRowEdit
                    {
                        Key = [new PreparedCell("id", 1L, "1")],
                        Changes = [new PreparedCell("nombre", "No debería quedar", "'No debería quedar'")],
                    },
                    new PreparedRowEdit
                    {
                        Key = [new PreparedCell("id", 999L, "999")],
                        Changes = [new PreparedCell("nombre", "Fantasma", "'Fantasma'")],
                    },
                ],
            };

            await Assert.ThrowsAsync<RowEditFailedException>(
                () => Fixture.RowEditor.ApplyAsync(session, batch, CancellationToken.None));

            var después = await ExecuteAsync(
                session,
                $"SELECT nombre FROM {Fixture.DefaultSchema}.{table} ORDER BY id");

            Assert.Equal(["Ana", "Bea", "Cris"], después.ResultSets[0].Rows.Select(row => row[0]));
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

    [Fact]
    public async Task LaSesionExponeElMotorCorrecto()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        Assert.Equal(Fixture.Provider.Engine, session.Engine);
        Assert.Equal(Fixture.Provider.Engine, Fixture.Executor.Engine);
        Assert.Equal(Fixture.Provider.Engine, Fixture.Metadata.Engine);
    }

    [Fact]
    public async Task UnaSesionDeOtroMotorSeRechaza()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        // Cada proveedor debe rechazar sesiones ajenas en lugar de intentar usarlas.
        var foreign = new ForeignSession();

        await Assert.ThrowsAsync<ArgumentException>(
            () => Fixture.Executor.ExecuteAsync(foreign, Query("SELECT 1"), CancellationToken.None));
    }

    /// <summary>Sesión que no pertenece a ningún proveedor real.</summary>
    private sealed class ForeignSession : IDatabaseSession
    {
        public Guid Id => Guid.NewGuid();

        public DatabaseEngine Engine => DatabaseEngine.MySql;

        /// <summary>No habla con ningún motor, así que no hay dónde abrir una.</summary>
        public SessionTransaction Transaction => SessionTransaction.None;

        /// <summary>Los dobles no hablan con ningún motor: no hay nada que garantizar.</summary>
        public bool ReadOnlyEnforcedByEngine => false;

        public ConnectionProfile Profile => new()
        {
            Id = Guid.NewGuid(),
            Name = "ajena",
            Engine = DatabaseEngine.MySql,
            Host = "localhost",
            Port = 3306,
            Database = "x",
            Username = "y",
        };

        public string ServerVersion => "0";

        public bool IsOpen => true;

        public ValueTask DisposeAsync() => ValueTask.CompletedTask;
    }
}
