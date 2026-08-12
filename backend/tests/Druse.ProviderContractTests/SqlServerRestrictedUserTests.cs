using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.ProviderContractTests;

/// <summary>
/// Regresión propia de SQL Server: **el explorador tiene que funcionar con un
/// usuario de aplicación normal**, sin permisos de administración.
///
/// No forma parte del contrato compartido —los otros motores no tienen este
/// problema— pero vive aquí porque necesita un servidor real, igual que él.
///
/// El caso que la trajo: listar tablas leía el recuento de filas de la DMV
/// `sys.dm_db_partition_stats`, que exige `VIEW DATABASE STATE`. Contra una base
/// restringida el servidor respondía con el error 262 y **el usuario se quedaba
/// sin poder ver ninguna tabla**, por culpa de un número informativo.
/// </summary>
public sealed class SqlServerRestrictedUserTests
{
    private const string LoginName = "druse_sin_permisos";
    private const string LoginPassword = "Druse_dev_only_2";

    private readonly SqlServerFixture _fixture = new();

    private bool Skip => !_fixture.IsAvailable;

    [Fact]
    public async Task UnUsuarioSinPermisosDeAdministracion_PuedeListarLasTablas()
    {
        if (Skip) { return; }

        await using var admin = await OpenAsync(_fixture.Credentials);

        var table = $"druse_tmp_{Guid.NewGuid():N}";

        await SetUpRestrictedLoginAsync(admin, table);

        try
        {
            // La sesión del usuario restringido: sin VIEW DATABASE STATE, que es
            // justo lo que tiene un usuario de aplicación en preproducción.
            await using var restricted = await OpenAsync(new DatabaseCredentials(LoginPassword));

            var folder = new DatabaseObject
            {
                Id = $"folder:{_fixture.DefaultSchema}:tables",
                Name = "Tables",
                Kind = DatabaseObjectKind.Folder,
                Database = _fixture.DatabaseName,
                Schema = _fixture.DefaultSchema,
            };

            var tables = await _fixture.Metadata.GetChildrenAsync(restricted, folder, CancellationToken.None);

            // Lo importante es que llegue hasta aquí: antes lanzaba una excepción.
            Assert.Contains(tables, item => item.Name == table);
        }
        finally
        {
            await TearDownAsync(admin, table);
        }
    }

    private async Task<IDatabaseSession> OpenAsync(DatabaseCredentials credentials)
    {
        var profile = _fixture.Profile();

        return await _fixture.Provider.OpenSessionAsync(
            credentials.Password == LoginPassword ? profile with { Username = LoginName } : profile,
            credentials,
            CancellationToken.None);
    }

    private async Task SetUpRestrictedLoginAsync(IDatabaseSession admin, string table)
    {
        await ExecuteAsync(admin, _fixture.CreateTable(table));

        // `DENY` explícito: en una instancia de desarrollo el permiso podría venir
        // concedido a public, y entonces la prueba no comprobaría nada.
        await ExecuteAsync(admin, $"""
            IF NOT EXISTS (SELECT 1 FROM sys.server_principals WHERE name = '{LoginName}')
                CREATE LOGIN {LoginName} WITH PASSWORD = '{LoginPassword}', CHECK_POLICY = OFF;
            """);

        await ExecuteAsync(admin, $"""
            IF NOT EXISTS (SELECT 1 FROM sys.database_principals WHERE name = '{LoginName}')
                CREATE USER {LoginName} FOR LOGIN {LoginName};
            ALTER ROLE db_datareader ADD MEMBER {LoginName};
            DENY VIEW DATABASE STATE TO {LoginName};
            """);
    }

    private async Task TearDownAsync(IDatabaseSession admin, string table)
    {
        await ExecuteAsync(admin, _fixture.DropTable(table));

        // Cerrar la sesión no cierra la conexión: el pool la conserva, y SQL
        // Server se niega a eliminar un inicio de sesión que sigue conectado.
        Microsoft.Data.SqlClient.SqlConnection.ClearAllPools();

        // Estos dos no se afirman: la comprobación ya está hecha y el servidor es
        // desechable. Si alguno quedara sin borrar, la preparación es idempotente
        // y la siguiente ejecución lo reutiliza.
        await ExecuteQuietlyAsync(admin, $"DROP USER IF EXISTS {LoginName};");
        await ExecuteQuietlyAsync(admin, $"DROP LOGIN {LoginName};");
    }

    private async Task ExecuteQuietlyAsync(IDatabaseSession session, string sql) =>
        await _fixture.Executor.ExecuteAsync(session, Request(session, sql), CancellationToken.None);

    private async Task ExecuteAsync(IDatabaseSession session, string sql)
    {
        var result = await _fixture.Executor.ExecuteAsync(
            session,
            Request(session, sql),
            CancellationToken.None);

        Assert.True(
            result.State == QueryExecutionState.Succeeded,
            $"Preparando la prueba falló: {result.Error?.Message}");
    }

    private static QueryRequest Request(IDatabaseSession session, string sql) => new()
    {
        SessionId = session.Id,
        Sql = sql,
        MaxRows = 1,
        TimeoutSeconds = 30,
        DestructiveConfirmed = true,
    };
}
