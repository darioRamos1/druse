using System.Text.Json;

namespace Druse.Application.Reports;

/// <summary>Cómo se prepara una fuente.</summary>
public enum ReportSourceMode
{
    /// <summary>SQL escrito a mano.</summary>
    Sql,

    /// <summary>SQL generado por el compositor a partir de su estado.</summary>
    Visual,
}

/// <summary>Cuántas filas de cada lado puede tener una misma clave.</summary>
public enum ReportJoinCardinality
{
    /// <summary>Cada clave aparece una vez a cada lado.</summary>
    OneToOne,

    /// <summary>
    /// La izquierda puede repetir la clave y la derecha no: la derecha es el lado
    /// «uno», como las metas mensuales frente a las ventas diarias.
    /// </summary>
    ManyToOne,
}

/// <summary>Columna que la fuente devolvió la última vez que se revisó.</summary>
public sealed record ReportExpectedColumn(string Name, string ClrType);

public sealed record ReportSourceDefinition
{
    /// <summary>Nombre corto con el que se habla de la fuente en la interfaz.</summary>
    public required string Alias { get; init; }

    /// <summary>Perfil guardado: las credenciales nunca viajan en la definición.</summary>
    public required Guid ConnectionId { get; init; }

    public required string Database { get; init; }

    public required ReportSourceMode Mode { get; init; }

    /// <summary>Lo que se ejecuta. En modo visual, el SQL que generó el compositor.</summary>
    public required string Sql { get; init; }

    /// <summary>
    /// Copia del estado del compositor, en JSON. Se conserva también en modo SQL
    /// para poder volver al visual sin perder lo que se había elegido, y es una
    /// copia para que editar una composición guardada no cambie el reporte.
    /// </summary>
    public string? VisualModel { get; init; }

    /// <summary>Vacío hasta la primera vista previa válida.</summary>
    public IReadOnlyList<ReportExpectedColumn> ExpectedColumns { get; init; } = [];
}

public sealed record ReportJoinDefinition(
    IReadOnlyList<ReportJoinKey> Keys,
    ReportJoinKind Kind,
    ReportJoinCardinality Cardinality);

/// <summary>Conjunto de datos: una o dos fuentes y, con dos, cómo se combinan.</summary>
public sealed record ReportDataset
{
    public const int MaxSources = 2;

    public required Guid Id { get; init; }

    public required string Name { get; init; }

    /// <summary>
    /// Sube cada vez que cambian las fuentes o la unión. Los resultados guardados
    /// la recuerdan para avisar de que son de una definición anterior.
    /// </summary>
    public long Version { get; init; }

    public required IReadOnlyList<ReportSourceDefinition> Sources { get; init; }

    public ReportJoinDefinition? Join { get; init; }

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }
}

public static class ReportDatasetValidator
{
    /// <summary>Lo que falta o sobra para poder guardar o previsualizar. Vacío si vale.</summary>
    public static IReadOnlyList<string> Validate(ReportDataset dataset)
    {
        ArgumentNullException.ThrowIfNull(dataset);
        var errors = new List<string>();
        if (string.IsNullOrWhiteSpace(dataset.Name))
        {
            errors.Add("El conjunto de datos necesita un nombre.");
        }

        if (dataset.Sources is not { Count: >= 1 and <= ReportDataset.MaxSources })
        {
            errors.Add("Un conjunto de datos usa una o dos fuentes.");
            return errors;
        }

        foreach (var source in dataset.Sources)
        {
            if (string.IsNullOrWhiteSpace(source.Alias))
            {
                errors.Add("Cada fuente necesita un alias.");
            }

            if (source.ConnectionId == Guid.Empty || string.IsNullOrWhiteSpace(source.Database))
            {
                errors.Add($"La fuente {source.Alias} necesita una conexión y una base.");
            }

            if (!Enum.IsDefined(source.Mode))
            {
                errors.Add($"La fuente {source.Alias} tiene un modo desconocido.");
            }

            if (string.IsNullOrWhiteSpace(source.Sql))
            {
                errors.Add($"La fuente {source.Alias} no tiene consulta.");
            }

            if (source.Mode == ReportSourceMode.Visual && !IsJson(source.VisualModel))
            {
                errors.Add($"La fuente visual {source.Alias} no conserva el estado del compositor.");
            }
        }

        if (dataset.Sources.Select(source => source.Alias.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count()
            != dataset.Sources.Count)
        {
            errors.Add("Las fuentes deben tener alias distintos.");
        }

        if (dataset.Sources.Count == 2)
        {
            if (dataset.Join is not { Keys.Count: > 0 } join)
            {
                errors.Add("Con dos fuentes hay que elegir al menos una columna de unión.");
            }
            else if (!Enum.IsDefined(join.Kind) || !Enum.IsDefined(join.Cardinality))
            {
                errors.Add("El tipo de unión o la cardinalidad no son válidos.");
            }
            else if (join.Keys.Any(key => string.IsNullOrWhiteSpace(key.Left) || string.IsNullOrWhiteSpace(key.Right)))
            {
                errors.Add("Cada par de la unión necesita una columna a cada lado.");
            }
        }
        else if (dataset.Join is not null)
        {
            errors.Add("Una unión necesita dos fuentes.");
        }

        return errors;
    }

    private static bool IsJson(string? text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return false;
        }

        try
        {
            using var _ = JsonDocument.Parse(text);
            return true;
        }
        catch (JsonException)
        {
            return false;
        }
    }
}
