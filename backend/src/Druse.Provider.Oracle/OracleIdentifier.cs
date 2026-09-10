namespace Druse.Provider.Oracle;

/// <summary>
/// Cómo se escribe un nombre para que Oracle lo entienda.
///
/// Es la decisión más consecuente del proveedor, y no se parece a la de los
/// otros cuatro. En PostgreSQL, SQL Server y MySQL citar un nombre es gratis:
/// `"clientes"`, `[clientes]` y `` `clientes` `` significan lo mismo que
/// `clientes`. **En Oracle no**: citar además lo hace sensible a mayúsculas, y
/// como el motor sube a mayúsculas todo lo que no va citado, `"clientes"` y
/// `clientes` son dos tablas distintas.
///
/// Citarlo todo —que es lo que hacen los demás proveedores— crearía tablas que
/// solo Druse sabe leer: `SELECT * FROM clientes` desde SQL*Plus o desde
/// cualquier informe fallaría, porque la tabla se llamaría `clientes` y esa
/// consulta pregunta por `CLIENTES`. Es la clase de daño que no se ve hasta que
/// alguien abre la base con otra herramienta.
///
/// Así que **se cita solo lo que lo necesita**, y lo demás se escribe como lo
/// escribiría el propio motor: en mayúsculas y sin comillas. Es lo que hacen SQL
/// Developer y DBeaver, y por eso una tabla creada desde Druse se lee igual que
/// las que ya había.
///
/// **Lo que cuesta**: un objeto cuyo nombre real esté en minúscula —porque
/// alguien lo creó citado— no se puede referir con este camino. Es raro, y
/// distinguirlo de un nombre que el usuario acaba de teclear en minúscula no es
/// posible desde aquí: los dos llegan igual. Se prefiere fallar en ese caso raro
/// a producir tablas que el resto del mundo no puede consultar.
/// </summary>
internal static class OracleIdentifier
{
    /// <summary>Lo máximo que admite un nombre desde 12.2. Antes eran 30.</summary>
    private const int MaxLength = 128;

    public static string Quote(string identifier)
    {
        ArgumentNullException.ThrowIfNull(identifier);

        return IsPlain(identifier)
            ? identifier.ToUpperInvariant()
            : $"\"{identifier.Replace("\"", "\"\"", StringComparison.Ordinal)}\"";
    }

    /// <summary>
    /// Si el nombre es de los que Oracle acepta sin comillas.
    ///
    /// Empieza por letra y sigue con letras, dígitos o `_`, `$` y `#`, que son
    /// los tres símbolos que su gramática admite. No se comprueba si además es
    /// una palabra reservada: la lista tiene más de doscientas entradas, cambia
    /// entre versiones, y equivocarse cuesta un error del motor que dice
    /// exactamente cuál es la palabra.
    /// </summary>
    private static bool IsPlain(string identifier)
    {
        if (identifier.Length is 0 or > MaxLength || !char.IsAsciiLetter(identifier[0]))
        {
            return false;
        }

        foreach (var character in identifier)
        {
            if (!char.IsAsciiLetterOrDigit(character) && character is not ('_' or '$' or '#'))
            {
                return false;
            }
        }

        return true;
    }
}
