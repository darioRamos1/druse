using System.Globalization;

namespace Druse.Domain;

/// <summary>
/// Un problema de Reportes BI que se le cuenta al usuario, con su clave.
///
/// Es <see cref="InvalidOperationException"/> porque los sitios que ya
/// capturaban esa excepción —la vista previa, la actualización— siguen
/// funcionando igual; lo nuevo es que el mensaje viaja también con su clave y
/// la interfaz lo escribe en el idioma elegido.
/// </summary>
public sealed class ReportProblemException(UserMessage localized) : InvalidOperationException(localized.Text)
{
    public UserMessage Localized { get; } = localized;
}

/// <summary>
/// Los mensajes de Reportes BI, con el texto en español al lado de su clave.
///
/// Juntos en un archivo para que una frase y su clave no se separen: cambiar
/// el texto aquí obliga a mirar el catálogo, y al revés.
/// </summary>
public static class ReportMessages
{
    private static UserMessage Plain(string key, string text) => new(key, text);

    private static UserMessage One(string key, string text, string name, string value) =>
        UserMessage.With(key, text, name, value);

    // --- Actualizar -----------------------------------------------------------

    public static UserMessage Canceled() =>
        Plain(MessageKeys.Reports.Canceled, "Se canceló la actualización.");

    public static UserMessage SourceUnreadable() =>
        Plain(MessageKeys.Reports.SourceUnreadable, "No se pudo leer alguna fuente. Se conserva el resultado anterior.");

    public static UserMessage SourceTruncated() =>
        Plain(MessageKeys.Reports.SourceTruncated, "Alguna fuente supera el límite de filas o de tamaño. Agrupa o filtra su consulta.");

    public static UserMessage NewerResult() =>
        Plain(MessageKeys.Reports.NewerResult, "Ya hay un resultado más reciente; este intento no lo sustituye.");

    public static UserMessage Interrupted() =>
        Plain(MessageKeys.Reports.Interrupted, "Druse se cerró mientras se actualizaba. Se conservan los datos anteriores.");

    public static UserMessage Busy() =>
        Plain(MessageKeys.Reports.Busy, "Este conjunto de datos ya se está actualizando.");

    public static UserMessage Quota(long quotaMiB) =>
        One(MessageKeys.Reports.Quota,
            $"Los resultados guardados de Reportes superarían los {quotaMiB} MiB. Borra los datos guardados de algún conjunto que ya no uses.",
            "quota", quotaMiB.ToString(CultureInfo.InvariantCulture));

    public static UserMessage TooLarge() =>
        Plain(MessageKeys.Reports.TooLarge, "El resultado BI supera los 32 MiB. Reduce las filas o columnas de la consulta.");

    // --- Leer una fuente --------------------------------------------------------

    public static UserMessage ReadOnlyQuery() =>
        Plain(MessageKeys.Reports.ReadOnlyQuery, "Las fuentes de BI deben usar consultas de lectura.");

    public static UserMessage NoResultSet() =>
        Plain(MessageKeys.Reports.NoResultSet, "La consulta de BI debe devolver un conjunto de datos.");

    public static UserMessage SingleResultSet() =>
        Plain(MessageKeys.Reports.SingleResultSet, "Cada fuente de BI debe devolver un solo conjunto de datos.");

    // --- Unir -----------------------------------------------------------------

    public static UserMessage JoinNeedsSources() =>
        Plain(MessageKeys.Reports.JoinNeedsSources, "La unión necesita que las dos fuentes se lean bien.");

    public static UserMessage JoinTruncated() =>
        Plain(MessageKeys.Reports.JoinTruncated, "Una fuente de BI quedó truncada. Reduce las filas o columnas de la consulta.");

    public static UserMessage JoinNoKeys() =>
        Plain(MessageKeys.Reports.JoinNoKeys, "Elige al menos una columna de unión.");

    public static UserMessage JoinTypesDiffer(string left, string right) =>
        new(MessageKeys.Reports.JoinTypesDiffer, $"Las columnas {left} y {right} tienen tipos distintos.",
            new Dictionary<string, string> { ["left"] = left, ["right"] = right });

    public static UserMessage JoinNeedsConversion(string column) =>
        One(MessageKeys.Reports.JoinNeedsConversion, $"El tipo de la columna {column} requiere una conversión.", "column", column);

    public static UserMessage JoinColumnMissing(string column) =>
        One(MessageKeys.Reports.JoinColumnMissing, $"La columna de unión {column} falta o es ambigua.", "column", column);

    public static UserMessage JoinRightDuplicates() =>
        Plain(MessageKeys.Reports.JoinRightDuplicates, "La fuente derecha tiene claves de unión duplicadas.");

    public static UserMessage JoinLeftDuplicates() =>
        Plain(MessageKeys.Reports.JoinLeftDuplicates,
            "La fuente izquierda tiene claves de unión duplicadas. Si se esperan, elige la cardinalidad 1:N.");

    // --- Definición del conjunto -------------------------------------------------

    public static UserMessage DatasetName() =>
        Plain(MessageKeys.Reports.DatasetName, "El conjunto de datos necesita un nombre.");

    public static UserMessage SourceCount() =>
        Plain(MessageKeys.Reports.SourceCount, "Un conjunto de datos usa una o dos fuentes.");

    public static UserMessage SourceAlias() =>
        Plain(MessageKeys.Reports.SourceAlias, "Cada fuente necesita un alias.");

    public static UserMessage SourceConnection(string alias) =>
        One(MessageKeys.Reports.SourceConnection, $"La fuente {alias} necesita una conexión y una base.", "alias", alias);

    public static UserMessage SourceMode(string alias) =>
        One(MessageKeys.Reports.SourceMode, $"La fuente {alias} tiene un modo desconocido.", "alias", alias);

    public static UserMessage SourceSql(string alias) =>
        One(MessageKeys.Reports.SourceSql, $"La fuente {alias} no tiene consulta.", "alias", alias);

    public static UserMessage SourceVisual(string alias) =>
        One(MessageKeys.Reports.SourceVisual, $"La fuente visual {alias} no conserva el estado del compositor.", "alias", alias);

    public static UserMessage DistinctAliases() =>
        Plain(MessageKeys.Reports.DistinctAliases, "Las fuentes deben tener alias distintos.");

    public static UserMessage JoinKeys() =>
        Plain(MessageKeys.Reports.JoinKeys, "Con dos fuentes hay que elegir al menos una columna de unión.");

    public static UserMessage JoinKind() =>
        Plain(MessageKeys.Reports.JoinKind, "El tipo de unión o la cardinalidad no son válidos.");

    public static UserMessage JoinPair() =>
        Plain(MessageKeys.Reports.JoinPair, "Cada par de la unión necesita una columna a cada lado.");

    public static UserMessage JoinTwoSources() =>
        Plain(MessageKeys.Reports.JoinTwoSources, "Una unión necesita dos fuentes.");

    // --- Programación ------------------------------------------------------------

    public static UserMessage ScheduleFrequency() =>
        Plain(MessageKeys.Reports.ScheduleFrequency, "La frecuencia es diaria o semanal.");

    public static UserMessage ScheduleTime() =>
        Plain(MessageKeys.Reports.ScheduleTime, "La hora va en formato HH:mm.");

    public static UserMessage ScheduleDay(string day) =>
        One(MessageKeys.Reports.ScheduleDay, $"«{day}» no es un día de la semana.", "day", day);

    public static UserMessage ScheduleDays() =>
        Plain(MessageKeys.Reports.ScheduleDays, "Una programación semanal necesita al menos un día.");

    public static UserMessage ScheduleZone() =>
        Plain(MessageKeys.Reports.ScheduleZone, "No se reconoce esa zona horaria.");

    // --- Reportes, tableros, plantillas y exportación --------------------------

    public static UserMessage ReportInvalid() =>
        Plain(MessageKeys.Reports.ReportInvalid, "Un reporte necesita nombre, tipo de visualización y ajustes.");

    public static UserMessage ReportDatasetMissing() =>
        Plain(MessageKeys.Reports.ReportDatasetMissing, "El conjunto de datos de este reporte ya no existe.");

    public static UserMessage DashboardInvalid() =>
        Plain(MessageKeys.Reports.DashboardInvalid, "Un tablero necesita nombre y diseño.");

    public static UserMessage TemplateScope() =>
        Plain(MessageKeys.Reports.TemplateScope, "Una plantilla es de un reporte, un panel o un tablero.");

    public static UserMessage TemplateName() =>
        Plain(MessageKeys.Reports.TemplateName, "Una plantilla necesita un nombre de hasta 120 caracteres.");

    public static UserMessage TemplateDescription() =>
        Plain(MessageKeys.Reports.TemplateDescription, "La descripción de una plantilla admite hasta 400 caracteres.");

    public static UserMessage TemplateSize() =>
        Plain(MessageKeys.Reports.TemplateSize, "El diseño de la plantilla falta o supera 512 KiB.");

    public static UserMessage TemplateInvalid() =>
        Plain(MessageKeys.Reports.TemplateInvalid, "El diseño de la plantilla no es válido.");

    public static UserMessage TemplateForbidden(string property) =>
        One(MessageKeys.Reports.TemplateForbidden,
            $"Una plantilla no puede llevar «{property}»: solo guarda el diseño, sin SQL, conexiones ni filas.",
            "property", property);

    // --- Identidades de empresa --------------------------------------------------

    public static UserMessage IdentityName(int max) =>
        One(MessageKeys.Reports.IdentityName, $"Una identidad necesita el nombre de la empresa, de hasta {max} caracteres.",
            "max", max.ToString(CultureInfo.InvariantCulture));

    public static UserMessage IdentityDetails(int max) =>
        One(MessageKeys.Reports.IdentityDetails, $"Los datos de la empresa admiten hasta {max} líneas.",
            "max", max.ToString(CultureInfo.InvariantCulture));

    public static UserMessage IdentityLine(int max) =>
        One(MessageKeys.Reports.IdentityLine, $"El subtítulo, cada línea de datos y el pie admiten hasta {max} caracteres.",
            "max", max.ToString(CultureInfo.InvariantCulture));

    public static UserMessage IdentityColor() =>
        Plain(MessageKeys.Reports.IdentityColor, "El color de marca va en hexadecimal, como #0A6CBF.");

    public static UserMessage IdentityLogoType() =>
        Plain(MessageKeys.Reports.IdentityLogoType, "El logo tiene que ser una imagen PNG, JPEG o WebP.");

    public static UserMessage IdentityLogoSize(int maxKib) =>
        One(MessageKeys.Reports.IdentityLogoSize, $"El logo supera {maxKib} KiB.",
            "max", maxKib.ToString(CultureInfo.InvariantCulture));

    public static UserMessage IdentityLogoDimensions(int width, int height) =>
        new(MessageKeys.Reports.IdentityLogoDimensions, $"El logo admite hasta {width} × {height} píxeles.",
            new Dictionary<string, string>
            {
                ["width"] = width.ToString(CultureInfo.InvariantCulture),
                ["height"] = height.ToString(CultureInfo.InvariantCulture),
            });

    public static UserMessage IdentityMissing() =>
        Plain(MessageKeys.Reports.IdentityMissing, "Esa identidad ya no existe.");

    public static UserMessage ExportEmpty() =>
        Plain(MessageKeys.Reports.ExportEmpty, "No hay paneles que exportar.");

    public static UserMessage ExportPanels(int max) =>
        One(MessageKeys.Reports.ExportPanels, $"Un libro admite hasta {max} paneles.",
            "max", max.ToString(CultureInfo.InvariantCulture));

    public static UserMessage ExportDataset() =>
        Plain(MessageKeys.Reports.ExportDataset, "Un panel apunta a un conjunto de datos que no viene en la exportación.");

    public static UserMessage ExportTable() =>
        Plain(MessageKeys.Reports.ExportTable, "Una tabla de la exportación tiene filas que no cuadran con sus columnas.");

    public static UserMessage ExportCells(long max) =>
        One(MessageKeys.Reports.ExportCells, $"La exportación supera las {max} celdas. Filtra o exporta menos paneles.",
            "max", max.ToString(CultureInfo.InvariantCulture));

    /// <summary>El mensaje con clave de una excepción de Reportes, si lo trae.</summary>
    public static UserMessage? From(Exception exception) =>
        exception is ReportProblemException problem ? problem.Localized : null;
}
