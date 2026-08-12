using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Application.Queries;
using Druse.Database.Abstractions;
using Druse.Host.LocalApi.Security;
using Druse.Infrastructure.Providers;
using Druse.Infrastructure.Queries;
using Druse.Infrastructure.Sessions;
using Druse.Persistence.Sqlite;
using Druse.Platform.Abstractions;
using Druse.Platform.Native;
using Druse.Platform.Native.Secrets;
using Druse.Provider.PostgreSql;

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

        services.AddSingleton<LocalApiToken>();

        // --- Persistencia local ----------------------------------------------
        services.AddSingleton<DruseDatabase>();
        services.AddScoped<IConnectionProfileStore, SqliteConnectionProfileStore>();
        services.AddScoped<IQueryHistoryStore, SqliteQueryHistoryStore>();
        services.AddScoped<IPreferencesStore, SqlitePreferencesStore>();

        // --- Proveedores de motor ---------------------------------------------
        // Añadir MySQL en la Fase 8 será registrar sus tres piezas aquí.
        services.AddSingleton<IDatabaseProvider, PostgreSqlDatabaseProvider>();
        services.AddSingleton<IDatabaseMetadataReader, PostgreSqlMetadataReader>();
        services.AddSingleton<IQueryExecutor, PostgreSqlQueryExecutor>();

        services.AddSingleton<IProviderRegistry, ProviderRegistry>();

        // --- Estado del proceso ------------------------------------------------
        // Sesiones y ejecuciones son singleton porque representan recursos vivos
        // que sobreviven a la petición que los creó.
        services.AddSingleton<ISessionRegistry, SessionRegistry>();
        services.AddSingleton<IQueryExecutionTracker, QueryExecutionTracker>();

        // --- Casos de uso -------------------------------------------------------
        services.AddScoped<ConnectionService>();
        services.AddScoped<SavedConnectionService>();
        services.AddScoped<MetadataService>();
        services.AddScoped<QueryService>();

        return services;
    }
}
