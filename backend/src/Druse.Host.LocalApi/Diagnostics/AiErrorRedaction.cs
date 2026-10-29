using System.Text.RegularExpressions;

namespace Druse.Host.LocalApi.Diagnostics;

/// <summary>
/// Los controladores pueden incluir cadenas de conexión en el diagnóstico. Este filtro
/// se aplica también al historial y a peticiones directas antes de mostrar la vista previa.
/// Reconoce formatos conocidos; la revisión humana sigue siendo necesaria para otros datos.
/// </summary>
internal static partial class AiErrorRedaction
{
    private const string Hidden = "[oculto]";

    [GeneratedRegex(@"[^\r\n]*\b(?:server|host|data\s*source|initial\s*catalog|database|dbname|port|dsn|driver)\s*=\s*[^\r\n]*",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex ConnectionLine();

    [GeneratedRegex(@"(?:jdbc:[^\s""'<>]+|(?:postgres(?:ql)?|mysql|mariadb|mssql|sqlserver|oracle|mongodb(?:\+srv)?)://[^\s""'<>]+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex ConnectionUri();

    [GeneratedRegex(@"\bAuthorization\s*:\s*(?:Bearer|Basic)\s+[^\s,;""']+",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex Authorization();

    [GeneratedRegex(@"[""']?\b(?:password|pwd|user\s*id|username|user|uid|(?:access[_-]?)?token|api[_-]?key|secret)[""']?\s*(?:=|:)\s*(?:""(?:[^""\\]|\\.)*""|'(?:[^']|'')*'|[^\s;,}\]]+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex Credential();

    [GeneratedRegex(@"\b(?:password|identified\s+by)\s+(?:'[^']*(?:''[^']*)*'|""[^""]*""|[^\s;,]+)",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant, 100)]
    private static partial Regex SqlPassword();

    public static string Clean(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return "";
        }
        try
        {
            var clean = ConnectionLine().Replace(text, "[cadena de conexión oculta]");
            clean = ConnectionUri().Replace(clean, "[cadena de conexión oculta]");
            clean = Authorization().Replace(clean, Hidden);
            clean = Credential().Replace(clean, Hidden);
            return SqlPassword().Replace(clean, Hidden);
        }
        catch (RegexMatchTimeoutException)
        {
            // Un texto adverso tampoco debe conseguir saltarse la limpieza.
            return "[diagnóstico oculto: no se pudo revisar automáticamente]";
        }
    }
}
