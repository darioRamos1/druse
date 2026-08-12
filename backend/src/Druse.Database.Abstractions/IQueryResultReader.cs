using Druse.Domain;

namespace Druse.Database.Abstractions;

/// <summary>
/// Lectura progresiva de un conjunto de resultados.
///
/// Existe para exportar: `ExecuteAsync` materializa las filas en memoria porque
/// van a pintarse en una cuadrícula con un límite pequeño, pero exportar una
/// tabla de millones de filas por ese camino agotaría la memoria del proceso.
///
/// Quien lo abre debe liberarlo: mantiene viva la conexión mientras se lee
/// (plan §5).
/// </summary>
public interface IQueryResultReader : IAsyncDisposable
{
    /// <summary>Columnas del resultado, conocidas antes de leer ninguna fila.</summary>
    IReadOnlyList<ResultColumn> Columns { get; }

    /// <summary>
    /// Filas, una a una y según se piden.
    ///
    /// El valor devuelto es el mismo búfer en cada iteración: quien lo consuma
    /// debe copiarlo si necesita conservarlo. Se hace así para no reservar un
    /// array por fila durante una exportación larga.
    /// </summary>
    IAsyncEnumerable<IReadOnlyList<string?>> ReadRowsAsync(CancellationToken cancellationToken);
}
