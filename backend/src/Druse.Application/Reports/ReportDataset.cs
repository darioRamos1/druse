using System.Text.Json;
using Druse.Domain;

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
    /// <summary>
    /// Lo que falta o sobra para poder guardar o previsualizar. Vacío si vale.
    ///
    /// La vista previa no exige unión (<paramref name="requireJoin"/> en falso):
    /// las columnas de unión se eligen entre las que devuelve cada fuente, y
    /// para verlas hay que haberlas leído antes.
    /// </summary>
    public static IReadOnlyList<string> Validate(ReportDataset dataset, bool requireJoin = true) =>
        ValidateMessages(dataset, requireJoin).Select(message => message.Text).ToArray();

    /// <summary>Lo mismo con su clave, para decirlo en el idioma de la ventana.</summary>
    public static IReadOnlyList<UserMessage> ValidateMessages(ReportDataset dataset, bool requireJoin = true)
    {
        ArgumentNullException.ThrowIfNull(dataset);
        var errors = new List<UserMessage>();
        if (string.IsNullOrWhiteSpace(dataset.Name))
        {
            errors.Add(ReportMessages.DatasetName());
        }

        if (dataset.Sources is not { Count: >= 1 and <= ReportDataset.MaxSources })
        {
            errors.Add(ReportMessages.SourceCount());
            return errors;
        }

        foreach (var source in dataset.Sources)
        {
            if (string.IsNullOrWhiteSpace(source.Alias))
            {
                errors.Add(ReportMessages.SourceAlias());
            }

            if (source.ConnectionId == Guid.Empty || string.IsNullOrWhiteSpace(source.Database))
            {
                errors.Add(ReportMessages.SourceConnection(source.Alias));
            }

            if (!Enum.IsDefined(source.Mode))
            {
                errors.Add(ReportMessages.SourceMode(source.Alias));
            }

            if (string.IsNullOrWhiteSpace(source.Sql))
            {
                errors.Add(ReportMessages.SourceSql(source.Alias));
            }

            if (source.Mode == ReportSourceMode.Visual && !IsJson(source.VisualModel))
            {
                errors.Add(ReportMessages.SourceVisual(source.Alias));
            }
        }

        if (dataset.Sources.Select(source => source.Alias.Trim()).Distinct(StringComparer.OrdinalIgnoreCase).Count()
            != dataset.Sources.Count)
        {
            errors.Add(ReportMessages.DistinctAliases());
        }

        if (dataset.Sources.Count == 2 && !requireJoin && dataset.Join is null)
        {
            return errors;
        }

        if (dataset.Sources.Count == 2)
        {
            if (dataset.Join is not { Keys.Count: > 0 } join)
            {
                errors.Add(ReportMessages.JoinKeys());
            }
            else if (!Enum.IsDefined(join.Kind) || !Enum.IsDefined(join.Cardinality))
            {
                errors.Add(ReportMessages.JoinKind());
            }
            else if (join.Keys.Any(key => string.IsNullOrWhiteSpace(key.Left) || string.IsNullOrWhiteSpace(key.Right)))
            {
                errors.Add(ReportMessages.JoinPair());
            }
        }
        else if (dataset.Join is not null)
        {
            errors.Add(ReportMessages.JoinTwoSources());
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
