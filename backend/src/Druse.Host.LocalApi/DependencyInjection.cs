using Druse.Application.Abstractions;
using Druse.Application.Backups;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Application.Queries;
using Druse.Application.Rows;
using Druse.Application.Tables;
using Druse.Application.Transactions;
using Druse.Database.Abstractions;
using Druse.Host.LocalApi.Security;
using Druse.Infrastructure.Backups;
using Druse.Infrastructure.Exports;
using Druse.Infrastructure.Importing;
using Druse.Infrastructure.Providers;
using Druse.Infrastructure.Queries;
using Druse.Infrastructure.Sessions;
using Druse.Persistence.Sqlite;
using Druse.Platform.Abstractions;
using Druse.Platform.Native;
using Druse.Platform.Native.Secrets;
#if DRUSE_INFORMIX
using Druse.Provider.Informix;
#endif
using Druse.Provider.MySql;
using Druse.Provider.PostgreSql;
using Druse.Provider.SqlServer;
using Druse.Ssh;

namespace Druse.Host.LocalApi;

/// <summary>
/// Composición de dependencias.
///
/// Este es el **único** lugar del sistema donde se nombran implementaciones
/// concretas. Todo lo demás trabaja contra interfaces (ADR 0001).
/// </summary>
internal static class DependencyInjection
{
    public static IServiceCollection AddDruse(this IServiceCollection services)
    {
        // --- Plataforma -------------------------------------------------------
        services.AddSingleton<IAppPaths, AppPaths>();

        // Enseña las carpetas del equipo para elegir dónde va un respaldo sin
        // teclear la ruta. En el navegador es la única forma; el escritorio usa
        // su diálogo nativo.
        services.AddSingleton<IFolderBrowser, FolderBrowser>();

        // El almacén se elige según el sistema; si no hay ninguno utilizable,
        // la fábrica devuelve NullSecretStore y la aplicación pide la contraseña
        // cada vez en lugar de fingir que la guarda bien.
        services.AddSingleton(_ => SecretStoreFactory.Create());

        services.AddSingleton<LocalApiEndpoint>();

        // --- Persistencia local ----------------------------------------------
        services.AddSingleton<DruseDatabase>();
        services.AddSingleton<IBackupArchiveFactory, BackupArchiveFactory>();
        services.AddScoped<IConnectionProfileStore, SqliteConnectionProfileStore>();
        services.AddScoped<IQueryHistoryStore, SqliteQueryHistoryStore>();
        services.AddScoped<IPreferencesStore, SqlitePreferencesStore>();
        services.AddScoped<IEditorTabStore, SqliteEditorTabStore>();
        services.AddScoped<IBackupProfileStore, SqliteBackupProfileStore>();

        // --- Proveedores de motor ---------------------------------------------
        // Cada motor aporta sus piezas y nada más. MySQL entró en la Fase 8
        // exactamente así: unas líneas aquí, sin tocar Domain, Application ni la
        // interfaz.
        //
        // El diseñador y el guionizador son la misma clase por motor: escribir un
        // `CREATE TABLE` desde un diseño y escribirlo desde el catálogo son la
        // misma tarea con distinta entrada, y el dialecto tiene que vivir en un
        // solo sitio. Se registran por separado porque los casos de uso piden uno
        // u otro, no los dos.
        services.AddSingleton<IDatabaseProvider, PostgreSqlDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, PostgreSqlMetadataReader>();
        services.AddSingleton<IQueryExecutor, PostgreSqlQueryExecutor>();
        services.AddSingleton<IRowEditor, PostgreSqlRowEditor>();
        services.AddSingleton<ITableDesigner, PostgreSqlTableDesigner>();
        services.AddSingleton<IDatabaseScripter, PostgreSqlTableDesigner>();

        services.AddSingleton<IDatabaseProvider, SqlServerDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, SqlServerMetadataReader>();
        services.AddSingleton<IQueryExecutor, SqlServerQueryExecutor>();
        services.AddSingleton<IRowEditor, SqlServerRowEditor>();
        services.AddSingleton<ITableDesigner, SqlServerTableDesigner>();
        services.AddSingleton<IDatabaseScripter, SqlServerTableDesigner>();

        services.AddSingleton<IDatabaseProvider, MySqlDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, MySqlMetadataReader>();
        services.AddSingleton<IQueryExecutor, MySqlQueryExecutor>();
        services.AddSingleton<IRowEditor, MySqlRowEditor>();
        services.AddSingleton<ITableDesigner, MySqlTableDesigner>();
        services.AddSingleton<IDatabaseScripter, MySqlTableDesigner>();

        // Informix solo si se compiló con él: su driver pesa 111 MB y la
        // compilación ligera lo deja fuera. Ver `IncludeInformix` en el csproj.
#if DRUSE_INFORMIX
        services.AddSingleton<IDatabaseProvider, InformixDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, InformixMetadataReader>();
        services.AddSingleton<IQueryExecutor, InformixQueryExecutor>();
        services.AddSingleton<IRowEditor, InformixRowEditor>();
        services.AddSingleton<ITableDesigner, InformixTableDesigner>();
        services.AddSingleton<IDatabaseScripter, InformixTableDesigner>();
#endif

        services.AddSingleton<IProviderRegistry, ProviderRegistry>();

        // --- Estado del proceso ------------------------------------------------
        // Sesiones y ejecuciones son singleton porque representan recursos vivos
        // que sobreviven a la petición que los creó.
        services.AddSingleton<ISessionRegistry, SessionRegistry>();
        services.AddSingleton<IQueryExecutionTracker, QueryExecutionTracker>();

        // El estado de los respaldos es singleton porque sobrevive a la petición
        // que los lanzó, y también a que se cierre la ventana: el trabajo sigue en
        // este proceso y quien vuelva tiene que encontrarlo donde lo dejó.
        services.AddSingleton<IBackupTracker, BackupTracker>();
        services.AddSingleton<IRestoreTracker, RestoreTracker>();

        // Un túnel dura lo que dura su sesión, así que se guarda igual que ella.
        services.AddSingleton<ISshTunnelRegistry, SshTunnelRegistry>();
        services.AddSingleton<ISshTunnelFactory, SshTunnelFactory>();

        // Las transacciones manuales también sobreviven a la petición: se abren
        // en una y se confirman en otra. Y el barrido que deshace las olvidadas
        // tiene que seguir corriendo aunque nadie pida nada.
        //
        // El tiempo de espera se puede acortar con
        // `Transactions:IdleTimeoutMinutes`, que es lo que hace comprobable
        // contra un motor real que la transacción olvidada se deshace: nadie va a
        // esperar quince minutos delante de la pantalla. Un número negativo lo
        // desactiva del todo.
        services.AddSingleton(provider =>
        {
            var configured = provider
                .GetRequiredService<IConfiguration>()
                .GetValue<double?>("Transactions:IdleTimeoutMinutes");

            return new TransactionService(
                provider.GetRequiredService<IProviderRegistry>(),
                provider.GetRequiredService<ISessionRegistry>(),
                configured is { } minutes ? TimeSpan.FromMinutes(minutes) : null);
        });
        services.AddHostedService<IdleTransactionSweeper>();

        // --- Casos de uso -------------------------------------------------------
        services.AddScoped<ConnectionService>();
        services.AddScoped<SavedConnectionService>();
        services.AddScoped<MetadataService>();
        services.AddScoped<QueryService>();
        services.AddScoped<RowEditService>();
        services.AddScoped<TableDesignService>();
        services.AddScoped<ImportService>();
        services.AddScoped<ExportService>();
        services.AddScoped<BackupService>();
        services.AddScoped<BackupProfileService>();
        services.AddScoped<RestoreService>();

        // --- Exportadores -------------------------------------------------------
        services.AddSingleton<IResultExporter, CsvResultExporter>();
        services.AddSingleton<IResultExporter, XlsxResultExporter>();

        // --- Lectores de archivo ------------------------------------------------
        services.AddSingleton<ITableFileReader, CsvTableFileReader>();
        services.AddSingleton<ITableFileReader, XlsxTableFileReader>();

        return services;
    }
}
