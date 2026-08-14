using System.Text;
using System.Text.RegularExpressions;

namespace Druse.Domain;

/// <summary>Motivo por el que una instrucción se considera peligrosa.</summary>
public enum SqlRiskKind
{
    None = 0,
    Drop = 1,
    Truncate = 2,
    DeleteWithoutFilter = 3,
    UpdateWithoutFilter = 4,
    SchemaChange = 5,
    PermissionChange = 6,
}

/// <summary>Aviso sobre una instrucción potencialmente destructiva.</summary>
public sealed record SqlRisk(SqlRiskKind Kind, string Description);

/// <summary>
/// Detecta instrucciones potencialmente destructivas antes de ejecutarlas.
///
/// **Esto es una ayuda visual, no un mecanismo de seguridad.** Un análisis léxico
/// no sustituye a los permisos configurados en el servidor: hay formas de borrar
/// datos que no detecta, y la última palabra la tiene siempre el motor. Su valor
/// está en evitar el descuido, no el ataque (plan §12).
/// </summary>
public static class SqlSafetyAnalyzer
{
    // COLUMN y CONSTRAINT entran aquí porque `ALTER TABLE … DROP COLUMN` borra
    // datos de verdad; llamarlo solo «cambio de estructura» se queda corto.
    private static readonly Regex DropPattern = new(
        @"\bDROP\s+(TABLE|DATABASE|SCHEMA|VIEW|INDEX|FUNCTION|PROCEDURE|SEQUENCE|TYPE|COLUMN|CONSTRAINT)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex TruncatePattern = new(
        @"\bTRUNCATE\s+(TABLE\s+)?\w",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex DeletePattern = new(
        @"\bDELETE\s+FROM\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex UpdatePattern = new(
        @"\bUPDATE\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex WherePattern = new(
        @"\bWHERE\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex AlterPattern = new(
        @"\bALTER\s+(TABLE|DATABASE|SCHEMA|VIEW|FUNCTION|PROCEDURE|TYPE)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly Regex PermissionPattern = new(
        @"\b(GRANT|REVOKE)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>Instrucciones que escriben, para el modo de solo lectura.</summary>
    private static readonly Regex MutatingPattern = new(
        @"\b(INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER|CREATE|GRANT|REVOKE|MERGE|REPLACE|COMMENT)\b",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant | RegexOptions.Compiled);

    /// <summary>Enumera los riesgos detectados. Lista vacía significa que no se detectó ninguno.</summary>
    public static IReadOnlyList<SqlRisk> Analyze(string sql)
    {
        if (string.IsNullOrWhiteSpace(sql))
        {
            return [];
        }

        var stripped = StripLiteralsAndComments(sql);
        var risks = new List<SqlRisk>();

        if (DropPattern.IsMatch(stripped))
        {
            risks.Add(new SqlRisk(
                SqlRiskKind.Drop,
                "La instrucción elimina un objeto de la base de datos junto con sus datos."));
        }

        if (TruncatePattern.IsMatch(stripped))
        {
            risks.Add(new SqlRisk(SqlRiskKind.Truncate, "TRUNCATE vacía la tabla por completo y no suele poder deshacerse."));
        }

        // Un DELETE o UPDATE sin WHERE afecta a todas las filas. Se mira por
        // instrucción, no sobre el texto entero: un WHERE en otra sentencia
        // del mismo lote no protege a esta.
        foreach (var statement in SplitStatements(stripped))
        {
            if (DeletePattern.IsMatch(statement) && !WherePattern.IsMatch(statement))
            {
                risks.Add(new SqlRisk(
                    SqlRiskKind.DeleteWithoutFilter,
                    "DELETE sin WHERE: borra todas las filas de la tabla."));
            }

            if (UpdatePattern.IsMatch(statement) && !WherePattern.IsMatch(statement))
            {
                risks.Add(new SqlRisk(
                    SqlRiskKind.UpdateWithoutFilter,
                    "UPDATE sin WHERE: modifica todas las filas de la tabla."));
            }
        }

        if (AlterPattern.IsMatch(stripped))
        {
            risks.Add(new SqlRisk(SqlRiskKind.SchemaChange, "La instrucción modifica la estructura de la base de datos."));
        }

        if (PermissionPattern.IsMatch(stripped))
        {
            risks.Add(new SqlRisk(SqlRiskKind.PermissionChange, "La instrucción cambia permisos."));
        }

        return risks;
    }

    /// <summary>Indica si el texto escribe algo, para bloquearlo en conexiones de solo lectura.</summary>
    public static bool IsMutating(string sql) =>
        !string.IsNullOrWhiteSpace(sql) && MutatingPattern.IsMatch(StripLiteralsAndComments(sql));

    /// <summary>
    /// Sustituye por espacios el contenido de cadenas, identificadores citados y
    /// comentarios.
    ///
    /// Sin esto, un texto tan inocente como <c>SELECT 'drop table users'</c> se
    /// marcaría como destructivo, y los avisos que se disparan sin motivo acaban
    /// ignorándose siempre.
    /// </summary>
    private static string StripLiteralsAndComments(string sql)
    {
        var output = new StringBuilder(sql.Length);
        var index = 0;

        while (index < sql.Length)
        {
            var current = sql[index];

            // Comentario de línea.
            if (current == '-' && index + 1 < sql.Length && sql[index + 1] == '-')
            {
                while (index < sql.Length && sql[index] != '\n')
                {
                    output.Append(' ');
                    index++;
                }

                continue;
            }

            // Comentario de bloque.
            if (current == '/' && index + 1 < sql.Length && sql[index + 1] == '*')
            {
                while (index < sql.Length && !(sql[index] == '*' && index + 1 < sql.Length && sql[index + 1] == '/'))
                {
                    output.Append(sql[index] == '\n' ? '\n' : ' ');
                    index++;
                }

                // Cierra el `*/`, si está.
                for (var skip = 0; skip < 2 && index < sql.Length; skip++, index++)
                {
                    output.Append(' ');
                }

                continue;
            }

            // Cadenas y literales citados: ' en todos los motores, " en PostgreSQL,
            // [] en SQL Server y ` en MySQL.
            if (current is '\'' or '"' or '`' or '[')
            {
                var closing = current == '[' ? ']' : current;

                output.Append(' ');
                index++;

                while (index < sql.Length)
                {
                    // Comilla doblada: escape del propio literal, no su fin.
                    if (sql[index] == closing && index + 1 < sql.Length && sql[index + 1] == closing)
                    {
                        output.Append("  ");
                        index += 2;
                        continue;
                    }

                    var isClosing = sql[index] == closing;
                    output.Append(sql[index] == '\n' ? '\n' : ' ');
                    index++;

                    if (isClosing)
                    {
                        break;
                    }
                }

                continue;
            }

            output.Append(current);
            index++;
        }

        return output.ToString();
    }

    /// <summary>Separa por `;`. El texto ya viene sin literales, así que no hay falsos cortes.</summary>
    private static string[] SplitStatements(string strippedSql) =>
        strippedSql.Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
}
