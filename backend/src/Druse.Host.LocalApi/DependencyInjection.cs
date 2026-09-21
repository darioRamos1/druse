using Druse.Application.Abstractions;
using Druse.Application.Ai;
using Druse.Application.Backups;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Application.Queries;
using Druse.Application.Rows;
using Druse.Application.Tables;
using Druse.Application.Transactions;
using Druse.Application.Transfers;
using Druse.Database.Abstractions;
using Druse.Host.LocalApi.Jobs;
using Druse.Host.LocalApi.Security;
using Druse.Infrastructure.Ai;
using Druse.Infrastructure.Backups;
using Druse.Infrastructure.Exports;
using Druse.Infrastructure.Importing;
using Druse.Infrastructure.Providers;
using Druse.Infrastructure.Queries;
using Druse.Infrastructure.Sessions;
using Druse.Infrastructure.Transfers;
using Druse.Persistence.Sqlite;
using Druse.Platform.Abstractions;
using Druse.Platform.Native;
using Druse.Platform.Native.Secrets;
#if DRUSE_INFORMIX
using Druse.Provider.Informix;
#endif
using Druse.Provider.MySql;
#if DRUSE_ORACLE
using Druse.Provider.Oracle;
#endif
using Druse.Provider.PostgreSql;
using Druse.Provider.Sqlite;
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
        services.AddScoped<ISqlSnippetStore, SqliteSqlSnippetStore>();
        services.AddScoped<IDiagramStore, SqliteDiagramStore>();
        services.AddScoped<IBackupProfileStore, SqliteBackupProfileStore>();
        services.AddScoped<ITransferProfileStore, SqliteTransferProfileStore>();
        services.AddScoped<IAiProviderStore, SqliteAiProviderStore>();

        // Los trabajos largos que hubo. Va en SQLite y no en memoria porque la
        // pregunta que responde —«¿quedó algo a medias?»— solo se hace después de
        // que el proceso anterior desapareciera.
        services.AddScoped<IJobStore, SqliteJobStore>();
        services.AddScoped<SavedAiProviderService>();

        // El cliente HTTP del asistente lleva su propio tiempo de espera, más
        // largo que el de una petición corriente: un modelo pensando tarda más
        // que cualquier API, y el corte por omisión de 100 segundos abortaría
        // respuestas que iban bien. Quien cancela es el usuario, no el reloj.
        services.AddHttpClient<OpenAiCompatibleProvider>(client =>
        {
            client.Timeout = TimeSpan.FromMinutes(10);
        });
        services.AddScoped<IAiProvider>(provider =>
            provider.GetRequiredService<OpenAiCompatibleProvider>());

        services.AddHttpClient<AnthropicProvider>(client =>
        {
            client.Timeout = TimeSpan.FromMinutes(10);
        });
        services.AddScoped<IAiProvider>(provider =>
            provider.GetRequiredService<AnthropicProvider>());

        services.AddHttpClient<GeminiProvider>(client =>
        {
            client.Timeout = TimeSpan.FromMinutes(10);
        });
        services.AddScoped<IAiProvider>(provider =>
            provider.GetRequiredService<GeminiProvider>());

        // El que habla con un programa del equipo. No necesita cliente HTTP: lo
        // que lanza es un proceso.
        services.AddScoped<IAiProvider, LocalCliProvider>();

        // Mira la sesión de esos programas y abre la ventana donde la piden. Va
        // aparte del proveedor porque no es hablar con un modelo.
        services.AddSingleton<ICliSession, CliSession>();

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

        services.AddSingleton<IDatabaseProvider, SqliteDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, SqliteMetadataReader>();
        services.AddSingleton<IQueryExecutor, SqliteQueryExecutor>();
        services.AddSingleton<IRowEditor, SqliteRowEditor>();
        services.AddSingleton<ITableDesigner, SqliteTableDesigner>();
        services.AddSingleton<IDatabaseScripter, SqliteTableDesigner>();

#if DRUSE_ORACLE
        services.AddSingleton<IDatabaseProvider, OracleDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, OracleMetadataReader>();
        services.AddSingleton<IQueryExecutor, OracleQueryExecutor>();
        services.AddSingleton<IRowEditor, OracleRowEditor>();
        services.AddSingleton<ITableDesigner, OracleTableDesigner>();
        services.AddSingleton<IDatabaseScripter, OracleTableDesigner>();
#endif

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

        // El mismo motor por su protocolo nativo. Solo se registra el proveedor:
        // catálogo, tipos y diseñador los comparte con el de arriba, y de eso se
        // encarga el registro.
        services.AddSingleton<IDatabaseProvider>(
            _ => new InformixDatabaseProvider(Druse.Domain.DatabaseEngine.InformixSqli));
        services.AddSingleton<IDatabaseMetadataReader>(
            _ => new InformixMetadataReader(Druse.Domain.DatabaseEngine.InformixSqli));
        services.AddSingleton<IQueryExecutor>(
            _ => new InformixQueryExecutor(Druse.Domain.DatabaseEngine.InformixSqli));
        services.AddSingleton<IRowEditor>(
            _ => new InformixRowEditor(Druse.Domain.DatabaseEngine.InformixSqli));
        services.AddSingleton<ITableDesigner>(
            _ => new InformixTableDesigner(Druse.Domain.DatabaseEngine.InformixSqli));
        services.AddSingleton<IDatabaseScripter>(
            _ => new InformixTableDesigner(Druse.Domain.DatabaseEngine.InformixSqli));
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
        services.AddSingleton<ITransferTracker, TransferTracker>();

        // Los trabajos largos —respaldos, restauraciones y traslados— salen de la
        // petición que los pide y siguen por su cuenta. La cola es singleton
        // porque es el proceso quien los tiene, y **cada trabajo recibe su propio
        // scope de servicios**: antes se llevaban los de la petición HTTP y los
        // seguían usando después de que esa petición cerrara su scope.
        services.AddSingleton<JobRunner>();
        services.AddSingleton<IBackgroundJobs>(provider => provider.GetRequiredService<JobRunner>());
        services.AddHostedService(provider => provider.GetRequiredService<JobRunner>());

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
        services.AddScoped<TransferProfileService>();
        services.AddScoped<RestoreService>();
        services.AddScoped<TypeTranslator>();
        services.AddScoped<TransferService>();

        // --- Exportadores -------------------------------------------------------
        services.AddSingleton<IResultExporter, CsvResultExporter>();
        services.AddSingleton<IResultExporter, XlsxResultExporter>();

        // --- Lectores de archivo ------------------------------------------------
        services.AddSingleton<ITableFileReader, CsvTableFileReader>();
        services.AddSingleton<ITableFileReader, XlsxTableFileReader>();

        return services;
    }
}
