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

    [Fact]
    public async Task ConexionConCredencialesMalas_FallaSinRevelarLaContrasena()
    {
        if (Skip) { return; }

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

    [Fact]
    public async Task ConexionAUnHostInexistente_FallaConMensajeUtil()
    {
        if (Skip) { return; }

        var profile = Fixture.Profile() with { Host = "host-que-no-existe.invalid" };

        var result = await Fixture.Provider.TestConnectionAsync(
            profile,
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
        Assert.Equal("numero", set.Columns[0].Name);
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
        Assert.Equal("a", result.ResultSets[0].Columns[0].Name);
        Assert.Equal("c", result.ResultSets[2].Columns[0].Name);
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

        var table = $"druse_tmp_{Guid.NewGuid():N}";

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

        Assert.Equal(4, folders.Count);
        Assert.All(folders, folder => Assert.Equal(DatabaseObjectKind.Folder, folder.Kind));
        Assert.Equal(["Tables", "Views", "Functions", "Procedures"], folders.Select(f => f.Name));
    }

    [Fact]
    public async Task ListaTablasYSusColumnas()
    {
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var table = $"druse_tmp_{Guid.NewGuid():N}";

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
            Assert.Equal("id", id.Name);
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

        var table = $"druse_tmp_{Guid.NewGuid():N}";

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
                        Name = $"ix_{table}",
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
                            Name = $"ck_{table}",
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

            var index = Assert.Single(structure.Indexes, item => item.Name == $"ix_{table}");

            Assert.Equal("id", Assert.Single(index.Columns).Name);
            Assert.False(index.IsPrimaryKey);
            Assert.False(index.IsConstraintIndex);

            // La clave primaria de la tabla llega como tal, y su índice queda
            // marcado para que la interfaz no ofrezca borrarlo suelto.
            Assert.NotNull(structure.PrimaryKey);
            Assert.Contains("id", structure.PrimaryKey!.Columns);
            Assert.Contains(structure.Indexes, item => item.IsPrimaryKey && item.IsConstraintIndex);

            if (Fixture.Designer.IndexCapabilities.SupportsCheckConstraints)
            {
                Assert.Contains(structure.CheckConstraints, item => item.Name == $"ck_{table}");
            }

            // Y al quitarlo, desaparece: leer después de borrar es lo que
            // distingue un borrado real de una instrucción que no hizo nada.
            await Fixture.Designer.AlterAsync(
                session,
                new TableAlteration { Table = target, DroppedIndexes = [$"ix_{table}"] },
                CancellationToken.None);

            var after = await Fixture.Metadata.GetTableStructureAsync(
                session,
                target,
                CancellationToken.None);

            Assert.DoesNotContain(after.Indexes, item => item.Name == $"ix_{table}");
        }
        finally
        {
            await ExecuteAsync(session, Fixture.DropTable(table));
        }
    }

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
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var procedureName = $"druse_params_{Guid.NewGuid():N}";

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

        var viewName = $"druse_view_{Guid.NewGuid():N}";

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
        if (Skip) { return; }

        await using var session = await OpenAsync();

        var procedureName = $"druse_procedure_{Guid.NewGuid():N}";

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
        if (Skip) { return; }

        var databaseName = Fixture.SecondaryDatabaseName;
        var schemaName = Fixture.DefaultSchemaFor(databaseName);
        var tableName = $"druse_multibase_{Guid.NewGuid():N}";
        var viewName = $"druse_multibase_view_{Guid.NewGuid():N}";

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

        var table = $"druse_tmp_{Guid.NewGuid():N}";

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

        var table = $"druse_tmp_{Guid.NewGuid():N}";

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

        var table = $"druse_tmp_{Guid.NewGuid():N}";

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
        Assert.Contains("usuarios", sql, StringComparison.Ordinal);
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

        var table = $"druse_tmp_{Guid.NewGuid():N}";

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
