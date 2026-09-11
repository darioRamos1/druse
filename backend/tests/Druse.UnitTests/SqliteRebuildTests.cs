using Druse.Database.Abstractions;
using Druse.Domain;
using Druse.Provider.Sqlite;

namespace Druse.UnitTests;

/// <summary>
/// Lo que sobrevive a reconstruir una tabla.
///
/// En SQLite cambiar el tipo de una columna es crear otra tabla, copiar las
/// filas, borrar la vieja y renombrar. Todo lo que cuelga de la tabla vieja
/// —disparadores, índices, condiciones de comprobación— **se va con ella, y el
/// motor no avisa**; las filas de las tablas que la referencian se van también,
/// por la cascada del `DROP TABLE`; y las vistas que la miraban hacen fallar el
/// renombrado por apuntar, durante un instante, a algo que ya no está.
///
/// Estas pruebas existen porque esa pérdida es silenciosa y definitiva: nadie
/// revisa un disparador después de cambiarle el tipo a una columna. No hacen
/// falta servidores: el motor es un archivo.
/// </summary>
public sealed class SqliteRebuildTests : IDisposable
{
    private readonly string _carpeta = Path.Combine(
        Path.GetTempPath(),
        $"druse-rehacer-{Guid.NewGuid():N}");

    private readonly SqliteDatabaseProvider _provider = new();
    private readonly SqliteTableDesigner _designer = new();
    private readonly SqliteQueryExecutor _executor = new();

    public SqliteRebuildTests() => Directory.CreateDirectory(_carpeta);

    public void Dispose()
    {
        try
        {
            Directory.Delete(_carpeta, recursive: true);
        }
        catch (IOException)
        {
            // El sistema se lleva su carpeta temporal cuando le toca.
        }
    }

    private ConnectionProfile Profile() => new()
    {
        Id = Guid.NewGuid(),
        Name = "SQLite",
        Engine = DatabaseEngine.Sqlite,
        Host = string.Empty,
        Port = 0,
        Database = Path.Combine(_carpeta, "rehacer.db"),
        Username = string.Empty,
    };

    private async Task<IDatabaseSession> AbrirAsync()
    {
        var profile = Profile();

        if (!File.Exists(profile.Database))
        {
            await _provider.CreateDatabaseAsync(profile, default, CancellationToken.None);
        }

        return await _provider.OpenSessionAsync(profile, default, CancellationToken.None);
    }

    private Task<QueryResult> EjecutarAsync(IDatabaseSession session, string sql) =>
        _executor.ExecuteAsync(
            session,
            new QueryRequest
            {
                SessionId = session.Id,
                Sql = sql,
                MaxRows = 100,
                TimeoutSeconds = 30,
                DestructiveConfirmed = true,
            },
            CancellationToken.None);

    private static DatabaseObject Tabla(string name) => new()
    {
        Id = name,
        Name = name,
        Kind = DatabaseObjectKind.Table,
        Database = "main",
        Schema = "main",
    };

    /// <summary>
    /// Cambiar el tipo de una columna **no debe llevarse nada por delante**.
    ///
    /// La tabla lleva de todo: una vista que la mira, un disparador que escribe
    /// en otra, un índice propio y filas dentro. Después del cambio tienen que
    /// seguir los cuatro, y el disparador tiene que seguir disparando: uno que
    /// existe y no salta es peor que uno que no está, porque nadie lo nota.
    /// </summary>
    [Fact]
    public async Task CambiarElTipoDeUnaColumnaConservaLoQueCuelgaDeLaTabla()
    {
        await using var session = await AbrirAsync();

        await EjecutarAsync(session, """
            CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, nit TEXT);
            CREATE TABLE auditoria (que TEXT);
            CREATE INDEX ix_clientes_nit ON clientes (nit);
            CREATE VIEW resumen AS SELECT nombre FROM clientes;
            CREATE TRIGGER tr_clientes AFTER INSERT ON clientes
            BEGIN
              INSERT INTO auditoria (que) VALUES ('alta');
            END;
            INSERT INTO clientes (id, nombre, nit) VALUES (1, 'Ana', '900');
            """);

        // El cambio: `nit` pasa de texto a número. Es lo que obliga a reconstruir.
        await _designer.AlterAsync(
            session,
            new TableAlteration
            {
                Table = Tabla("clientes"),
                AlteredColumns =
                [
                    new ColumnAlteration
                    {
                        CurrentName = "nit",
                        Column = new TableColumnDefinition { Name = "nit", DataType = "INTEGER" },
                    },
                ],
            },
            CancellationToken.None);

        // --- Las filas ------------------------------------------------------
        var filas = await EjecutarAsync(session, "SELECT nombre, nit FROM clientes");

        Assert.Equal(QueryExecutionState.Succeeded, filas.State);
        Assert.Equal(["Ana", "900"], Assert.Single(filas.ResultSets[0].Rows));

        // --- El tipo, que es lo que se pidió cambiar ------------------------
        var reader = new SqliteMetadataReader();
        var columnas = await reader.GetColumnsAsync(
            session,
            Tabla("clientes"),
            CancellationToken.None);

        Assert.Equal(
            "INTEGER",
            Assert.Single(columnas, column => column.Name == "nit").DataType);

        // --- El índice ------------------------------------------------------
        var estructura = await reader.GetTableStructureAsync(
            session,
            Tabla("clientes"),
            CancellationToken.None);

        Assert.Contains(estructura.Indexes, index => index.Name == "ix_clientes_nit");

        // --- La vista y el disparador ---------------------------------------
        var sobreviven = await EjecutarAsync(session, """
            SELECT type, name FROM sqlite_master
            WHERE name IN ('resumen', 'tr_clientes')
            ORDER BY name
            """);

        Assert.Equal(
            ["resumen", "tr_clientes"],
            sobreviven.ResultSets[0].Rows.Select(row => row[1]));

        // Y el disparador **dispara**, que es lo que de verdad importa: uno que
        // está y no salta no se distingue de uno que no está hasta que alguien
        // busca lo que debería haber escrito.
        await EjecutarAsync(session, "INSERT INTO clientes (id, nombre, nit) VALUES (2, 'Bea', 800)");

        var auditoria = await EjecutarAsync(session, "SELECT COUNT(*) FROM auditoria");

        Assert.Equal("2", auditoria.ResultSets[0].Rows[0][0]);
    }

    /// <summary>
    /// Reconstruir una tabla **no puede llevarse las filas de sus hijas**.
    ///
    /// Es el peligro que no se ve: reconstruir pasa por un `DROP TABLE`, y con
    /// las claves foráneas encendidas eso dispara el `ON DELETE CASCADE` de quien
    /// la referencia. Cambiar el tipo de una columna de la tabla de clientes
    /// borraría todos sus pedidos, en silencio y dentro de la misma transacción
    /// que se confirma sola.
    ///
    /// Es la razón por la que el procedimiento que documenta SQLite empieza
    /// apagando las claves foráneas.
    /// </summary>
    [Fact]
    public async Task ReconstruirNoBorraLasFilasDeLasTablasHijas()
    {
        await using var session = await AbrirAsync();

        await EjecutarAsync(session, """
            CREATE TABLE padres (id INTEGER PRIMARY KEY, nombre TEXT, codigo TEXT);
            CREATE TABLE hijas (
              id       INTEGER PRIMARY KEY,
              padre_id INTEGER REFERENCES padres (id) ON DELETE CASCADE
            );
            INSERT INTO padres (id, nombre, codigo) VALUES (1, 'Ana', 'A');
            INSERT INTO hijas (id, padre_id) VALUES (10, 1), (11, 1);
            """);

        await _designer.AlterAsync(
            session,
            new TableAlteration
            {
                Table = Tabla("padres"),
                AlteredColumns =
                [
                    new ColumnAlteration
                    {
                        CurrentName = "codigo",
                        Column = new TableColumnDefinition { Name = "codigo", DataType = "INTEGER" },
                    },
                ],
            },
            CancellationToken.None);

        var hijas = await EjecutarAsync(session, "SELECT COUNT(*) FROM hijas");

        Assert.Equal("2", hijas.ResultSets[0].Rows[0][0]);

        // Y las claves foráneas **vuelven a estar encendidas**: se apagan para
        // reconstruir, y dejarlas apagadas convertiría el resto de la sesión en
        // una donde las relaciones no se comprueban.
        var pragma = await EjecutarAsync(session, "PRAGMA foreign_keys");

        Assert.Equal("1", pragma.ResultSets[0].Rows[0][0]);
    }

    /// <summary>
    /// Con una transacción del usuario abierta, reconstruir **se para**.
    ///
    /// No es una limitación que se pueda ocultar: apagar las claves foráneas es un
    /// pragma que SQLite ignora dentro de una transacción, así que seguir adelante
    /// sería reconstruir con la cascada armada. Entre dejar un aviso y borrarle los
    /// pedidos a alguien, se deja el aviso.
    ///
    /// Y si nadie la referencia no hay nada que temer: eso se comprueba abajo, para
    /// que el aviso no se convierta en una negativa a trabajar.
    /// </summary>
    [Fact]
    public async Task ConUnaTransaccionAbiertaNoReconstruyeLoQueTieneHijas()
    {
        await using var session = await AbrirAsync();

        await EjecutarAsync(session, """
            CREATE TABLE padres (id INTEGER PRIMARY KEY, codigo TEXT);
            CREATE TABLE hijas (
              id       INTEGER PRIMARY KEY,
              padre_id INTEGER REFERENCES padres (id) ON DELETE CASCADE
            );
            INSERT INTO padres (id, codigo) VALUES (1, 'A');
            INSERT INTO hijas (id, padre_id) VALUES (10, 1), (11, 1);
            """);

        await session.Transaction.BeginAsync(CancellationToken.None);

        var error = await Assert.ThrowsAsync<DatabaseOperationException>(() =>
            _designer.AlterAsync(session, Cambiar("padres", "codigo"), CancellationToken.None));

        Assert.Contains("transacción abierta", error.Error.Message, StringComparison.Ordinal);

        // Lo que importa de verdad: las filas siguen ahí.
        var hijas = await EjecutarAsync(session, "SELECT COUNT(*) FROM hijas");

        Assert.Equal("2", hijas.ResultSets[0].Rows[0][0]);

        await session.Transaction.RollbackAsync(CancellationToken.None);
    }

    /// <summary>
    /// Con una transacción abierta, una tabla que nadie referencia **sí se
    /// reconstruye**: sin hijas no hay cascada, y negarse sería un «no» de adorno.
    /// </summary>
    [Fact]
    public async Task ConUnaTransaccionAbiertaSiReconstruyeLoQueNadieReferencia()
    {
        await using var session = await AbrirAsync();

        await EjecutarAsync(session, """
            CREATE TABLE sueltas (id INTEGER PRIMARY KEY, codigo TEXT);
            INSERT INTO sueltas (id, codigo) VALUES (1, '7');
            """);

        await session.Transaction.BeginAsync(CancellationToken.None);

        await _designer.AlterAsync(
            session,
            Cambiar("sueltas", "codigo"),
            CancellationToken.None);

        await session.Transaction.CommitAsync(CancellationToken.None);

        var reader = new SqliteMetadataReader();
        var columnas = await reader.GetColumnsAsync(
            session,
            Tabla("sueltas"),
            CancellationToken.None);

        Assert.Equal(
            "INTEGER",
            Assert.Single(columnas, column => column.Name == "codigo").DataType);
    }

    /// <summary>
    /// Reconstruir y renombrar a la vez **tampoco pierde nada**.
    ///
    /// Es el caso que obliga a renombrar dos veces: el texto de un disparador
    /// nombra la tabla de antes, así que primero se le devuelve ese nombre, se
    /// vuelven a poner las cosas que lo usan, y solo entonces se renombra de verdad
    /// —y ese renombrado lo arrastra todo, porque lo hace el motor—.
    /// </summary>
    [Fact]
    public async Task ReconstruirYRenombrarALaVezArrastraVistasYDisparadores()
    {
        await using var session = await AbrirAsync();

        await EjecutarAsync(session, """
            CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, nit TEXT);
            CREATE TABLE auditoria (que TEXT);
            CREATE VIEW resumen AS SELECT nombre FROM clientes;
            CREATE TRIGGER tr_clientes AFTER INSERT ON clientes
            BEGIN
              INSERT INTO auditoria (que) VALUES ('alta');
            END;
            INSERT INTO clientes (id, nombre, nit) VALUES (1, 'Ana', '900');
            """);

        await _designer.AlterAsync(
            session,
            Cambiar("clientes", "nit") with { NewName = "socios" },
            CancellationToken.None);

        // La vista sigue leyendo, y lee de la tabla nueva: el motor la reescribió.
        var vista = await EjecutarAsync(session, "SELECT nombre FROM resumen");

        Assert.Equal(["Ana"], Assert.Single(vista.ResultSets[0].Rows));

        // Y el disparador dispara sobre el nombre nuevo.
        await EjecutarAsync(session, "INSERT INTO socios (id, nombre, nit) VALUES (2, 'Bea', 800)");

        var auditoria = await EjecutarAsync(session, "SELECT COUNT(*) FROM auditoria");

        Assert.Equal("2", auditoria.ResultSets[0].Rows[0][0]);
    }

    /// <summary>
    /// Las condiciones de comprobación **sobreviven**.
    ///
    /// Son el caso más difícil de notar de todos: una condición que desaparece no
    /// rompe nada hoy. Lo que hace es dejar entrar mañana la fila que existía para
    /// impedir, y entonces ya no hay forma de saber cuándo se perdió.
    ///
    /// SQLite no las publica en ningún `PRAGMA`: hay que sacarlas del texto de su
    /// `CREATE TABLE`, que es lo único que las guarda.
    /// </summary>
    [Fact]
    public async Task LasCondicionesDeComprobacionSobreviven()
    {
        await using var session = await AbrirAsync();

        await EjecutarAsync(session, """
            CREATE TABLE pedidos (
              id       INTEGER PRIMARY KEY,
              cantidad INTEGER CHECK (cantidad > 0),
              estado   TEXT,
              CONSTRAINT ck_estado CHECK (estado IN ('nuevo', 'cerrado'))
            );
            INSERT INTO pedidos (id, cantidad, estado) VALUES (1, 5, 'nuevo');
            """);

        await _designer.AlterAsync(
            session,
            Cambiar("pedidos", "estado"),
            CancellationToken.None);

        // Las dos siguen impidiendo lo que impedían. Se comprueba por lo que hacen
        // y no por lo que dice el catálogo: una condición guardada que no rechaza
        // nada no sirve de nada.
        var cantidad = await EjecutarAsync(
            session,
            "INSERT INTO pedidos (id, cantidad, estado) VALUES (2, -1, 0)");

        Assert.Equal(QueryExecutionState.Failed, cantidad.State);

        var estado = await EjecutarAsync(
            session,
            "INSERT INTO pedidos (id, cantidad, estado) VALUES (3, 1, 9)");

        Assert.Equal(QueryExecutionState.Failed, estado.State);
    }

    /// <summary>
    /// Una reconstrucción que falla **no deja la conexión tocada**.
    ///
    /// Los pragmas no entran en la transacción: lo escrito se deshace, pero los
    /// dos ajustes que la reconstrucción necesita se quedarían puestos. Y los dos
    /// son peligrosos si se quedan, cada uno a su manera: con las claves foráneas
    /// apagadas el resto de la sesión escribe relaciones que nadie comprueba, y
    /// con `legacy_alter_table` encendido el siguiente renombrado —de cualquier
    /// tabla— deja de arrastrar las vistas y los disparadores, que es justo lo que
    /// se acaba de arreglar.
    ///
    /// El fallo se provoca borrando una columna que sostiene un índice: al
    /// rehacerlo, el índice pide una columna que ya no está.
    /// </summary>
    [Fact]
    public async Task UnaReconstruccionQueFallaDejaLaConexionComoEstaba()
    {
        await using var session = await AbrirAsync();

        await EjecutarAsync(session, """
            CREATE TABLE clientes (id INTEGER PRIMARY KEY, nombre TEXT, nit TEXT);
            CREATE INDEX ix_clientes_nit ON clientes (nit);
            """);

        await Assert.ThrowsAsync<TableChangeFailedException>(() =>
            _designer.AlterAsync(
                session,
                Cambiar("clientes", "nombre") with { DroppedColumns = ["nit"] },
                CancellationToken.None));

        var foraneas = await EjecutarAsync(session, "PRAGMA foreign_keys");
        var antiguo = await EjecutarAsync(session, "PRAGMA legacy_alter_table");

        Assert.Equal("1", foraneas.ResultSets[0].Rows[0][0]);
        Assert.Equal("0", antiguo.ResultSets[0].Rows[0][0]);

        // Y la tabla sigue siendo la que era: la transacción sí se deshizo.
        var columnas = await new SqliteMetadataReader().GetColumnsAsync(
            session,
            Tabla("clientes"),
            CancellationToken.None);

        Assert.Contains(columnas, column => column.Name == "nit");
    }

    /// <summary>El cambio de tipo más simple, que es el que obliga a reconstruir.</summary>
    private static TableAlteration Cambiar(string table, string column) => new()
    {
        Table = Tabla(table),
        AlteredColumns =
        [
            new ColumnAlteration
            {
                CurrentName = column,
                Column = new TableColumnDefinition { Name = column, DataType = "INTEGER" },
            },
        ],
    };
}
