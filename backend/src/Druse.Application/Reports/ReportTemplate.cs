using System.Text;
using System.Text.Json;

namespace Druse.Application.Reports;

/// <summary>Qué guarda una plantilla: un reporte, un panel con su reporte o un tablero entero.</summary>
public enum ReportTemplateScope
{
    Report,
    Panel,
    Dashboard,
}

/// <summary>
/// Una plantilla de diseño de Reportes BI.
///
/// `Model` es JSON y su forma la decide la interfaz, como el de los tableros:
/// diseño, apariencia y referencias lógicas a campos («Ventas», «Fecha»), que se
/// vinculan a columnas reales al aplicarla. No lleva SQL, conexiones ni filas:
/// se puede exportar y dársela a otra persona sin entregarle nada de sus bases.
/// </summary>
public sealed record ReportTemplate
{
    public required Guid Id { get; init; }

    public required string Name { get; init; }

    public string? Description { get; init; }

    public required ReportTemplateScope Scope { get; init; }

    public required string Model { get; init; }

    public DateTimeOffset CreatedAtUtc { get; init; }

    public DateTimeOffset UpdatedAtUtc { get; init; }
}

/// <summary>
/// Lo que el servidor exige a una plantilla antes de guardarla.
///
/// La interfaz ya valida el archivo al importarlo, pero este es el último sitio
/// por el que pasa antes de quedarse en disco: aquí se rechaza cualquier cosa
/// que parezca SQL, una conexión o datos, aunque la plantilla venga de un
/// archivo editado a mano.
/// </summary>
public static class ReportTemplateRules
{
    /// <summary>Una plantilla es diseño, no datos: medio MiB sobra para cientos de paneles.</summary>
    public const int MaxModelBytes = 512 * 1024;

    public const int MaxNameLength = 120;

    public const int MaxDescriptionLength = 400;

    /// <summary>Propiedades que solo tendría una plantilla con consultas, credenciales o filas.</summary>
    private static readonly HashSet<string> ForbiddenProperties = new(StringComparer.OrdinalIgnoreCase)
    {
        "sql",
        "query",
        "connectionId",
        "connection",
        "connectionString",
        "password",
        "secret",
        "database",
        "visualModel",
        "rows",
        "sampleRows",
    };

    /// <summary>`null` si se puede guardar; si no, el motivo para quien la envía.</summary>
    public static string? Validate(string? name, string? description, string? model)
    {
        var trimmed = name?.Trim() ?? string.Empty;
        if (trimmed.Length == 0 || trimmed.Length > MaxNameLength)
        {
            return "Una plantilla necesita un nombre de hasta 120 caracteres.";
        }

        if (description is { Length: > MaxDescriptionLength })
        {
            return "La descripción de una plantilla admite hasta 400 caracteres.";
        }

        if (string.IsNullOrWhiteSpace(model) || Encoding.UTF8.GetByteCount(model) > MaxModelBytes)
        {
            return "El diseño de la plantilla falta o supera 512 KiB.";
        }

        try
        {
            using var document = JsonDocument.Parse(model);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
            {
                return "El diseño de la plantilla no es válido.";
            }

            return FindForbidden(document.RootElement) is { } property
                ? $"Una plantilla no puede llevar «{property}»: solo guarda el diseño, sin SQL, conexiones ni filas."
                : null;
        }
        catch (JsonException)
        {
            return "El diseño de la plantilla no es válido.";
        }
    }

    private static string? FindForbidden(JsonElement element)
    {
        switch (element.ValueKind)
        {
            case JsonValueKind.Object:
                foreach (var property in element.EnumerateObject())
                {
                    if (ForbiddenProperties.Contains(property.Name))
                    {
                        return property.Name;
                    }

                    if (FindForbidden(property.Value) is { } nested)
                    {
                        return nested;
                    }
                }

                return null;
            case JsonValueKind.Array:
                foreach (var item in element.EnumerateArray())
                {
                    if (FindForbidden(item) is { } nested)
                    {
                        return nested;
                    }
                }

                return null;
            default:
                return null;
        }
    }
}
