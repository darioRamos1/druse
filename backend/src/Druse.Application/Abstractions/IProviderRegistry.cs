using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Abstractions;

/// <summary>
/// Localiza el proveedor, el lector de metadatos y el ejecutor de cada motor.
///
/// Es lo que permite que los casos de uso no tengan ni un solo <c>switch</c> por
/// motor: piden la pieza que corresponde y trabajan contra la interfaz. MySQL se
/// añadió registrando sus implementaciones, sin tocar este archivo.
/// </summary>
public interface IProviderRegistry
{
    /// <summary>Motores con soporte registrado.</summary>
    IReadOnlyCollection<DatabaseEngine> SupportedEngines { get; }

    IDatabaseProvider GetProvider(DatabaseEngine engine);

    IDatabaseMetadataReader GetMetadataReader(DatabaseEngine engine);

    IQueryExecutor GetQueryExecutor(DatabaseEngine engine);

    /// <summary>Quien escribe los cambios hechos sobre la cuadrícula.</summary>
    IRowEditor GetRowEditor(DatabaseEngine engine);
}

/// <summary>Se pidió un motor que nadie implementa.</summary>
public sealed class UnsupportedEngineException(DatabaseEngine engine)
    : InvalidOperationException($"No hay un proveedor registrado para el motor '{engine}'.")
{
    public DatabaseEngine Engine { get; } = engine;
}
