using Druse.Application.Connections;
using Druse.Domain;

namespace Druse.Application.Tables;

/// <summary>
/// Comprueba que un diseño tiene sentido antes de escribir una sola instrucción.
///
/// Detectar aquí un nombre vacío o dos columnas que se llaman igual ahorra al
/// usuario leer un error del motor sobre una sintaxis que él no escribió.
/// </summary>
public static class TableDesignValidator
{
    /// <summary>Caracteres que no se aceptan en un nombre, por muy citado que vaya.</summary>
    private static readonly char[] ForbiddenInNames = ['\0', '\n', '\r'];

    public static ValidationResult Validate(TableDefinition? table) =>
        Validate(table, capabilities: null);

    public static ValidationResult Validate(
        TableDefinition? table,
        IndexCapabilities? capabilities)
    {
        if (table is null)
        {
            return new ValidationResult(["La definición de la tabla es obligatoria."]);
        }

        var errors = new List<string>();

        ValidateName(table.Name, "la tabla", errors);

        if (table.Columns.Count == 0)
        {
            errors.Add("La tabla necesita al menos una columna.");
        }

        ValidateColumns(table.Columns, errors);

        var declared = table.Columns.Select(column => column.Name).ToList();

        ValidateIndexes(table.Indexes, declared, capabilities, errors);
        ValidateForeignKeys(table.ForeignKeys, declared, errors);
        ValidateUnique(table.UniqueConstraints, declared, errors);
        ValidateChecks(table.CheckConstraints, capabilities, errors);

        // Varias columnas pueden formar una clave primaria compuesta, pero solo
        // una puede generar su valor: dos identidades no las admite ningún motor.
        if (table.Columns.Count(column => column.IsIdentity) > 1)
        {
            errors.Add("Solo una columna puede generar su valor automáticamente.");
        }

        return new ValidationResult(errors);
    }

    public static ValidationResult Validate(TableAlteration? alteration) =>
        Validate(alteration, capabilities: null);

    public static ValidationResult Validate(
        TableAlteration? alteration,
        IndexCapabilities? capabilities)
    {
        if (alteration is null)
        {
            return new ValidationResult(["Los cambios sobre la tabla son obligatorios."]);
        }

        var errors = new List<string>();

        if (alteration.IsEmpty)
        {
            errors.Add("No hay ningún cambio que aplicar.");
        }

        if (alteration.NewName is not null)
        {
            ValidateName(alteration.NewName, "la tabla", errors);
        }

        ValidateColumns(
            [.. alteration.AddedColumns, .. alteration.AlteredColumns.Select(change => change.Column)],
            errors);

        foreach (var dropped in alteration.DroppedColumns)
        {
            ValidateName(dropped, "la columna", errors);
        }

        foreach (var change in alteration.AlteredColumns)
        {
            ValidateName(change.CurrentName, "la columna", errors);
        }

        // Cambiar una columna y borrarla en el mismo lote es contradictorio, y el
        // orden en que se ejecutara decidiría el resultado.
        var touched = alteration.AlteredColumns
            .Select(change => change.CurrentName)
            .Intersect(alteration.DroppedColumns, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (touched.Count > 0)
        {
            errors.Add(
                $"No se puede modificar y borrar la misma columna: {string.Join(", ", touched)}.");
        }

        // Las columnas que puede usar un índice o una restricción son las que ya
        // hay más las que se añaden en este mismo lote, menos las que se borran.
        // No se conoce la tabla entera aquí, así que solo se comprueba lo que
        // contradice al propio lote: exigir la lista completa obligaría a leer el
        // catálogo dentro de un validador que no habla con la base.
        var removed = alteration.DroppedColumns;

        ValidateIndexes(alteration.AddedIndexes, known: null, capabilities, errors);
        ValidateIndexes(
            [.. alteration.AlteredIndexes.Select(change => change.Index)],
            known: null,
            capabilities,
            errors);

        foreach (var change in alteration.AlteredIndexes)
        {
            ValidateName(change.CurrentName, "el índice", errors);
        }

        foreach (var name in alteration.DroppedIndexes)
        {
            ValidateName(name, "el índice", errors);
        }

        ValidateForeignKeys(alteration.AddedForeignKeys, known: null, errors);
        ValidateUnique(alteration.AddedUniqueConstraints, known: null, errors);
        ValidateChecks(alteration.AddedCheckConstraints, capabilities, errors);

        foreach (var name in alteration.DroppedForeignKeys
            .Concat(alteration.DroppedUniqueConstraints)
            .Concat(alteration.DroppedCheckConstraints))
        {
            ValidateName(name, "la restricción", errors);
        }

        if (alteration.NewPrimaryKey is { } primaryKey)
        {
            if (primaryKey.Name is not null)
            {
                ValidateName(primaryKey.Name, "la clave primaria", errors);
            }

            if (primaryKey.Columns.Count == 0)
            {
                errors.Add("La clave primaria necesita al menos una columna.");
            }

            var borrowed = primaryKey.Columns
                .Intersect(removed, StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (borrowed.Count > 0)
            {
                errors.Add(
                    "La clave primaria no puede usar columnas que se borran en el mismo cambio: " +
                    string.Join(", ", borrowed) + ".");
            }
        }

        if (alteration.DroppedPrimaryKeyName is not null)
        {
            ValidateName(alteration.DroppedPrimaryKeyName, "la clave primaria", errors);
        }

        return new ValidationResult(errors);
    }

    /// <summary>
    /// Comprueba los índices y, si se conocen, que sus columnas existan.
    ///
    /// <paramref name="known"/> es `null` cuando se modifica una tabla ya creada:
    /// allí las columnas válidas están en el catálogo y no en el diseño, así que
    /// comprobarlas contra una lista incompleta rechazaría índices correctos.
    /// </summary>
    private static void ValidateIndexes(
        IReadOnlyList<IndexDefinition> indexes,
        IReadOnlyList<string>? known,
        IndexCapabilities? capabilities,
        List<string> errors)
    {
        foreach (var index in indexes)
        {
            ValidateName(index.Name, "el índice", errors);

            if (index.Columns.Count == 0)
            {
                errors.Add($"El índice '{index.Name}' necesita al menos una columna.");
            }

            foreach (var column in index.Columns)
            {
                ValidateName(column.Name, "la columna del índice", errors);
            }

            var repeated = index.Columns
                .GroupBy(column => column.Name, StringComparer.OrdinalIgnoreCase)
                .Where(group => group.Count() > 1)
                .Select(group => group.Key)
                .ToList();

            if (repeated.Count > 0)
            {
                errors.Add(
                    $"El índice '{index.Name}' repite columnas: {string.Join(", ", repeated)}.");
            }

            if (known is not null)
            {
                ValidateReferences(
                    [.. index.Columns.Select(column => column.Name), .. index.IncludedColumns],
                    known,
                    $"El índice '{index.Name}'",
                    errors);
            }

            if (capabilities is null)
            {
                continue;
            }

            // Se rechaza aquí en lugar de dejar que el proveedor las ignore al
            // escribir el SQL: un índice que se crea callando una opción que se
            // pidió es peor que uno que no se crea.
            if (index.IncludedColumns.Count > 0 && !capabilities.SupportsIncludedColumns)
            {
                errors.Add(
                    $"El índice '{index.Name}' usa columnas incluidas y este motor no las admite.");
            }

            if (!string.IsNullOrWhiteSpace(index.Filter) && !capabilities.SupportsFilter)
            {
                errors.Add(
                    $"El índice '{index.Name}' usa una condición y este motor no admite índices parciales.");
            }

            if (!string.IsNullOrWhiteSpace(index.Method) &&
                capabilities.Methods.Count > 0 &&
                !capabilities.Methods.Contains(index.Method.Trim(), StringComparer.OrdinalIgnoreCase))
            {
                errors.Add(
                    $"El índice '{index.Name}' pide la estructura '{index.Method}', que este motor no ofrece.");
            }
        }

        var duplicated = indexes
            .GroupBy(index => index.Name, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();

        if (duplicated.Count > 0)
        {
            errors.Add($"Hay índices repetidos: {string.Join(", ", duplicated)}.");
        }
    }

    private static void ValidateForeignKeys(
        IReadOnlyList<ForeignKeyDefinition> keys,
        IReadOnlyList<string>? known,
        List<string> errors)
    {
        foreach (var key in keys)
        {
            ValidateName(key.Name, "la clave foránea", errors);
            ValidateName(key.ReferencedTable, "la tabla referenciada", errors);

            if (key.Columns.Count == 0)
            {
                errors.Add($"La clave foránea '{key.Name}' necesita al menos una columna.");
            }

            // Las dos listas emparejan por posición, así que distinta longitud no
            // es un descuido: es una clave que el motor rechazaría sin explicar
            // cuál de las dos sobra.
            if (key.Columns.Count != key.ReferencedColumns.Count)
            {
                errors.Add(
                    $"La clave foránea '{key.Name}' empareja {key.Columns.Count} columnas " +
                    $"con {key.ReferencedColumns.Count} referenciadas.");
            }

            foreach (var column in key.Columns.Concat(key.ReferencedColumns))
            {
                ValidateName(column, "la columna de la clave foránea", errors);
            }

            if (known is not null)
            {
                ValidateReferences(key.Columns, known, $"La clave foránea '{key.Name}'", errors);
            }
        }
    }

    private static void ValidateUnique(
        IReadOnlyList<UniqueConstraintDefinition> constraints,
        IReadOnlyList<string>? known,
        List<string> errors)
    {
        foreach (var constraint in constraints)
        {
            ValidateName(constraint.Name, "la restricción de unicidad", errors);

            if (constraint.Columns.Count == 0)
            {
                errors.Add($"La restricción '{constraint.Name}' necesita al menos una columna.");
            }

            foreach (var column in constraint.Columns)
            {
                ValidateName(column, "la columna de la restricción", errors);
            }

            if (known is not null)
            {
                ValidateReferences(
                    constraint.Columns,
                    known,
                    $"La restricción '{constraint.Name}'",
                    errors);
            }
        }
    }

    private static void ValidateChecks(
        IReadOnlyList<CheckConstraintDefinition> constraints,
        IndexCapabilities? capabilities,
        List<string> errors)
    {
        foreach (var constraint in constraints)
        {
            ValidateName(constraint.Name, "la restricción de comprobación", errors);

            if (string.IsNullOrWhiteSpace(constraint.Expression))
            {
                errors.Add($"La restricción '{constraint.Name}' necesita una condición.");
            }

            if (capabilities is not null && !capabilities.SupportsCheckConstraints)
            {
                errors.Add("Este motor no comprueba condiciones sobre las filas.");
            }
        }
    }

    /// <summary>Comprueba que unas columnas estén entre las que la tabla declara.</summary>
    private static void ValidateReferences(
        IReadOnlyList<string> used,
        IReadOnlyList<string> known,
        string subject,
        List<string> errors)
    {
        var missing = used
            .Where(column => !known.Contains(column, StringComparer.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (missing.Count > 0)
        {
            errors.Add($"{subject} usa columnas que la tabla no tiene: {string.Join(", ", missing)}.");
        }
    }

    private static void ValidateColumns(
        IReadOnlyList<TableColumnDefinition> columns,
        List<string> errors)
    {
        foreach (var column in columns)
        {
            ValidateName(column.Name, "la columna", errors);

            if (string.IsNullOrWhiteSpace(column.DataType))
            {
                errors.Add($"La columna '{column.Name}' necesita un tipo de dato.");
            }

            // Una clave primaria no admite nulos en ningún motor; dejar la casilla
            // marcada produciría un error del servidor difícil de relacionar.
            if (column.IsPrimaryKey && column.IsNullable)
            {
                errors.Add($"La columna '{column.Name}' es clave primaria y no puede admitir nulos.");
            }
        }

        var duplicated = columns
            .GroupBy(column => column.Name, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();

        if (duplicated.Count > 0)
        {
            errors.Add($"Hay columnas repetidas: {string.Join(", ", duplicated)}.");
        }
    }

    private static void ValidateName(string name, string what, List<string> errors)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            errors.Add($"El nombre de {what} es obligatorio.");
            return;
        }

        // Los identificadores se citan antes de escribirlos, así que un espacio o
        // un acento son legales. Un salto de línea o un nulo no: no hay forma de
        // citarlos y son la vía clásica para partir una instrucción en dos.
        if (name.IndexOfAny(ForbiddenInNames) >= 0)
        {
            errors.Add($"El nombre de {what} no puede contener saltos de línea.");
        }

        if (name.Length > 128)
        {
            errors.Add($"El nombre de {what} no puede superar 128 caracteres.");
        }
    }
}
