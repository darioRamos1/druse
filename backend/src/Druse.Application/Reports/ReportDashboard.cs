namespace Druse.Application.Reports;

/// <summary>
/// Un tablero: varios reportes en una cuadrícula, con filtros compartidos.
///
/// `Model` es JSON y su forma la decide la interfaz —páginas, paneles con su
/// posición y tamaño, filtros con sus columnas vinculadas—, como los ajustes de
/// los reportes. El servidor solo guarda y comprueba que sea JSON: el tablero se
/// pinta con los resultados guardados, sin tocar los orígenes.
/// </summary>
public sealed record ReportDashboard
{
    public required Guid Id { get; init; }

    public required string Name { get; init; }

    public required string Model { get; init; }

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }
}
