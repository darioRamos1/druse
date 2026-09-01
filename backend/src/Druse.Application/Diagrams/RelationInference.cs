using Druse.Domain;

namespace Druse.Application.Diagrams;

/// <summary>
/// Deduce, por el nombre de las columnas, las relaciones que el motor no
/// declara.
///
/// Es lo que hace útil un diagrama en una base real: MyISAM no tiene claves
/// foráneas, y casi cualquier esquema heredado tampoco, así que sin esto se
/// dibujarían ochenta tablas sueltas. **Nada de lo que sale de aquí es un
/// hecho:** son suposiciones con su motivo escrito, que el lienzo dibuja
/// distintas y que solo llegan a la base pasando por la previsualización del
/// `ALTER TABLE`.
///
/// No toca la sesión ni el catálogo a propósito. Recibe lo ya leído, así que se
/// prueba entero sin servidor —que es donde se caza un falso positivo— y no se
/// cuela dentro de la lectura, que tiene que seguir contando lo que el motor
/// dice y nada más.
/// </summary>
public static class RelationInference
{
    /// <summary>
    /// Nombres que no sugieren nada.
    ///
    /// Una columna llamada `estado` o `codigo` aparece en media base, y
    /// emparejarlas produciría un diagrama en el que todo apunta a todo. Es el
    /// filtro que separa una sugerencia útil de un adorno peligroso.
    /// </summary>
    private static readonly HashSet<string> Generic = new(StringComparer.OrdinalIgnoreCase)
    {
        "id", "codigo", "código", "code", "estado", "status", "fecha", "date",
        "nombre", "name", "tipo", "type", "descripcion", "descripción", "description",
        "valor", "value", "orden", "order", "total", "activo", "active", "usuario", "user",
    };

    /// <summary>
    /// Las relaciones que el nombre sugiere y el catálogo no declara.
    ///
    /// El resultado es determinista: se recorre en el orden en que llegan las
    /// tablas y sus columnas.
    /// </summary>
    public static IReadOnlyList<SuggestedRelation> Suggest(IReadOnlyList<TableDetail> tables)
    {
        ArgumentNullException.ThrowIfNull(tables);

        // Solo se puede apuntar a una tabla con clave primaria de una columna:
        // una compuesta necesitaría dos columnas en el origen, y adivinar cuáles
        // es inventar.
        var targets = new List<(TableRef Key, TableDetail Detail, string Primary)>();

        foreach (var detail in tables)
        {
            var primary = detail.Structure.PrimaryKey?.Columns;

            if (primary is { Count: 1 })
            {
                targets.Add((TableRef.Of(detail.Table), detail, primary[0]));
            }
        }

        var suggestions = new List<SuggestedRelation>();

        foreach (var detail in tables)
        {
            var own = TableRef.Of(detail.Table);
            var declared = DeclaredColumns(detail);
            var primary = detail.Structure.PrimaryKey?.Columns ?? [];

            foreach (var column in detail.Columns)
            {
                // Lo que ya es clave —primaria o foránea— no se supone.
                if (declared.Contains(column.Name) ||
                    primary.Contains(column.Name, StringComparer.OrdinalIgnoreCase))
                {
                    continue;
                }

                var match = Match(own, column, targets);

                if (match is not null)
                {
                    suggestions.Add(match);
                }
            }
        }

        return suggestions;
    }

    /// <summary>La mejor suposición para una columna, o ninguna.</summary>
    private static SuggestedRelation? Match(
        TableRef own,
        DatabaseColumn column,
        IReadOnlyList<(TableRef Key, TableDetail Detail, string Primary)> targets)
    {
        var stem = Stem(column.Name);

        if (stem is null)
        {
            return null;
        }

        var (candidate, exact) = FindTarget(stem.Value.Name, targets);

        if (candidate is null || candidate.Value.Key == own)
        {
            return null;
        }

        var target = candidate.Value;
        var referenced = target.Detail.Columns
            .FirstOrDefault(entry => entry.Name.Equals(target.Primary, StringComparison.OrdinalIgnoreCase));

        // Sin el tipo del destino no se puede comparar, y sin comparar el tipo
        // esto empareja `nit` con `pais` porque los dos acaban en texto.
        if (referenced is null || !Compatible(column.DataType, referenced.DataType))
        {
            return null;
        }

        var identical = Family(column.DataType) == Family(referenced.DataType) &&
            column.DataType.Equals(referenced.DataType, StringComparison.OrdinalIgnoreCase);

        // Alta cuando las tres cosas apuntan al mismo sitio: el nombre lleva el
        // sufijo, la tabla se llama exactamente así y el tipo es el mismo.
        var confidence = stem.Value.BySuffix && exact && identical
            ? SuggestionConfidence.High
            : SuggestionConfidence.Low;

        return new SuggestedRelation
        {
            From = own,
            Column = column.Name,
            To = target.Key,
            ReferencedColumn = target.Primary,
            Confidence = confidence,
            Reason = stem.Value.BySuffix
                ? $"«{column.Name}» nombra a «{target.Key.Name}» y el tipo encaja."
                : $"«{column.Name}» se llama como la clave de «{target.Key.Name}» y el tipo encaja.",
        };
    }

    /// <summary>Columnas que ya sostienen una clave foránea declarada.</summary>
    private static HashSet<string> DeclaredColumns(TableDetail detail)
    {
        var columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var key in detail.Structure.ForeignKeys)
        {
            foreach (var column in key.Columns)
            {
                columns.Add(column);
            }
        }

        return columns;
    }

    /// <summary>
    /// A qué nombre apunta una columna, y si lo hace por su sufijo.
    ///
    /// `cliente_id`, `id_cliente` y `clienteid` apuntan a `cliente`. Una columna
    /// que no lleve la marca puede seguir apuntando por llamarse igual que la
    /// clave de otra tabla, pero eso vale menos y se anota.
    /// </summary>
    private static (string Name, bool BySuffix)? Stem(string column)
    {
        var name = column.Trim();

        if (Generic.Contains(name))
        {
            return null;
        }

        foreach (var suffix in new[] { "_id", "_key", "_codigo" })
        {
            if (name.EndsWith(suffix, StringComparison.OrdinalIgnoreCase))
            {
                var stem = name[..^suffix.Length];

                return stem.Length == 0 ? null : (stem, true);
            }
        }

        foreach (var prefix in new[] { "id_", "cod_" })
        {
            if (name.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                var stem = name[prefix.Length..];

                return stem.Length == 0 ? null : (stem, true);
            }
        }

        if (name.EndsWith("id", StringComparison.OrdinalIgnoreCase) && name.Length > 2)
        {
            return (name[..^2], true);
        }

        return (name, false);
    }

    /// <summary>
    /// La tabla a la que se parece un nombre, y si el parecido es exacto.
    ///
    /// Se admite el plural en español y en inglés porque las dos convenciones
    /// conviven en la misma base más a menudo de lo que nadie querría. Si hay
    /// **más de una** candidata, no se sugiere ninguna: elegir sería inventar.
    /// </summary>
    private static ((TableRef Key, TableDetail Detail, string Primary)? Target, bool Exact) FindTarget(
        string stem,
        IReadOnlyList<(TableRef Key, TableDetail Detail, string Primary)> targets)
    {
        var matches = new List<((TableRef Key, TableDetail Detail, string Primary) Target, bool Exact)>();

        foreach (var target in targets)
        {
            var name = target.Key.Name;

            if (name.Equals(stem, StringComparison.OrdinalIgnoreCase))
            {
                matches.Add((target, true));
                continue;
            }

            if (SamePlural(stem, name))
            {
                matches.Add((target, false));
            }
        }

        if (matches.Count != 1)
        {
            return (null, false);
        }

        return (matches[0].Target, matches[0].Exact);
    }

    /// <summary>Uno es el plural del otro, en español o en inglés.</summary>
    private static bool SamePlural(string one, string other)
    {
        static IEnumerable<string> Forms(string name)
        {
            yield return name;
            yield return name + "s";
            yield return name + "es";

            if (name.EndsWith('y') && name.Length > 1)
            {
                yield return string.Concat(name.AsSpan(0, name.Length - 1), "ies");
            }

            if (name.EndsWith("es", StringComparison.OrdinalIgnoreCase) && name.Length > 2)
            {
                yield return name[..^2];
            }

            if (name.EndsWith('s') && name.Length > 1)
            {
                yield return name[..^1];
            }
        }

        return Forms(one).Any(form => form.Equals(other, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Los dos tipos pueden apuntarse.
    ///
    /// Un `varchar(10)` no apunta a un `bigint` por mucho que las columnas se
    /// llamen igual, y sin esta comprobación la mitad de las sugerencias serían
    /// imposibles de crear.
    /// </summary>
    private static bool Compatible(string one, string other)
    {
        var first = Family(one);

        return first != TypeFamily.Other && first == Family(other);
    }

    private enum TypeFamily
    {
        Other = 0,
        Integral,
        Text,
        Uuid,
    }

    /// <summary>
    /// Familia del tipo, por su nombre.
    ///
    /// Se mira el nombre y no un catálogo de tipos por motor porque cada uno
    /// escribe los suyos —`int4`, `INTEGER`, `NUMBER(10)`— y lo único que hace
    /// falta saber aquí es si dos columnas pueden emparejarse.
    /// </summary>
    private static TypeFamily Family(string dataType)
    {
        var type = dataType.ToLowerInvariant();

        if (type.Contains("uuid", StringComparison.Ordinal) ||
            type.Contains("uniqueidentifier", StringComparison.Ordinal))
        {
            return TypeFamily.Uuid;
        }

        if (type.Contains("char", StringComparison.Ordinal) ||
            type.Contains("text", StringComparison.Ordinal) ||
            type.Contains("clob", StringComparison.Ordinal))
        {
            return TypeFamily.Text;
        }

        if (type.Contains("int", StringComparison.Ordinal) ||
            type.Contains("serial", StringComparison.Ordinal) ||
            type.Contains("number", StringComparison.Ordinal) ||
            type.Contains("decimal", StringComparison.Ordinal) ||
            type.Contains("numeric", StringComparison.Ordinal))
        {
            return TypeFamily.Integral;
        }

        return TypeFamily.Other;
    }
}
