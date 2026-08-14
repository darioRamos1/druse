using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Application.Queries;
using Druse.Application.Rows;
using Druse.Application.Tables;
using Druse.Database.Abstractions;
using Druse.Host.LocalApi.Security;
using Druse.Infrastructure.Exports;
using Druse.Infrastructure.Importing;
using Druse.Infrastructure.Providers;
using Druse.Infrastructure.Queries;
using Druse.Infrastructure.Sessions;
using Druse.Persistence.Sqlite;
using Druse.Platform.Abstractions;
using Druse.Platform.Native;
using Druse.Platform.Native.Secrets;
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

        // El almacén se elige según el sistema; si no hay ninguno utilizable,
        // la fábrica devuelve NullSecretStore y la aplicación pide la contraseña
        // cada vez en lugar de fingir que la guarda bien.
        services.AddSingleton(_ => SecretStoreFactory.Create());

        services.AddSingleton<LocalApiEndpoint>();

        // --- Persistencia local ----------------------------------------------
        services.AddSingleton<DruseDatabase>();
        services.AddScoped<IConnectionProfileStore, SqliteConnectionProfileStore>();
        services.AddScoped<IQueryHistoryStore, SqliteQueryHistoryStore>();
        services.AddScoped<IPreferencesStore, SqlitePreferencesStore>();

        // --- Proveedores de motor ---------------------------------------------
        // Cada motor aporta sus piezas y nada más. MySQL entró en la Fase 8
        // exactamente así: unas líneas aquí, sin tocar Domain, Application ni la
        // interfaz.
        services.AddSingleton<IDatabaseProvider, PostgreSqlDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, PostgreSqlMetadataReader>();
        services.AddSingleton<IQueryExecutor, PostgreSqlQueryExecutor>();
        services.AddSingleton<IRowEditor, PostgreSqlRowEditor>();
        services.AddSingleton<ITableDesigner, PostgreSqlTableDesigner>();

        services.AddSingleton<IDatabaseProvider, SqlServerDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, SqlServerMetadataReader>();
        services.AddSingleton<IQueryExecutor, SqlServerQueryExecutor>();
        services.AddSingleton<IRowEditor, SqlServerRowEditor>();
        services.AddSingleton<ITableDesigner, SqlServerTableDesigner>();

        services.AddSingleton<IDatabaseProvider, MySqlDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, MySqlMetadataReader>();
        services.AddSingleton<IQueryExecutor, MySqlQueryExecutor>();
        services.AddSingleton<IRowEditor, MySqlRowEditor>();
        services.AddSingleton<ITableDesigner, MySqlTableDesigner>();

        services.AddSingleton<IProviderRegistry, ProviderRegistry>();

        // --- Estado del proceso ------------------------------------------------
        // Sesiones y ejecuciones son singleton porque representan recursos vivos
        // que sobreviven a la petición que los creó.
        services.AddSingleton<ISessionRegistry, SessionRegistry>();
        services.AddSingleton<IQueryExecutionTracker, QueryExecutionTracker>();

        // Un túnel dura lo que dura su sesión, así que se guarda igual que ella.
        services.AddSingleton<ISshTunnelRegistry, SshTunnelRegistry>();
        services.AddSingleton<ISshTunnelFactory, SshTunnelFactory>();

        // --- Casos de uso -------------------------------------------------------
        services.AddScoped<ConnectionService>();
        services.AddScoped<SavedConnectionService>();
        services.AddScoped<MetadataService>();
        services.AddScoped<QueryService>();
        services.AddScoped<RowEditService>();
        services.AddScoped<TableDesignService>();
        services.AddScoped<ImportService>();
        services.AddScoped<ExportService>();

        // --- Exportadores -------------------------------------------------------
        services.AddSingleton<IResultExporter, CsvResultExporter>();
        services.AddSingleton<IResultExporter, XlsxResultExporter>();

        // --- Lectores de archivo ------------------------------------------------
        services.AddSingleton<ITableFileReader, CsvTableFileReader>();
        services.AddSingleton<ITableFileReader, XlsxTableFileReader>();

        return services;
    }
}
