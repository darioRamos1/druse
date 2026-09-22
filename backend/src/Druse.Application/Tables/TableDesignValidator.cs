using System.Globalization;

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
            return new ValidationResult(
                [new UserMessage(MessageKeys.Table.Required, "La definición de la tabla es obligatoria.")]);
        }

        var errors = new List<UserMessage>();

        ValidateName(table.Name, "la tabla", MessageKeys.Thing.Table, errors);

        if (table.Columns.Count == 0)
        {
            errors.Add(new UserMessage(
                MessageKeys.Table.NoColumns,
                "La tabla necesita al menos una columna."));
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
            errors.Add(new UserMessage(
                MessageKeys.Table.SingleIdentity,
                "Solo una columna puede generar su valor automáticamente."));
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
            return new ValidationResult(
                [new UserMessage(
                    MessageKeys.Table.AlterationRequired,
                    "Los cambios sobre la tabla son obligatorios.")]);
        }

        var errors = new List<UserMessage>();

        if (alteration.IsEmpty)
        {
            errors.Add(new UserMessage(MessageKeys.Table.NoChanges, "No hay ningún cambio que aplicar."));
        }

        if (alteration.NewName is not null)
        {
            ValidateName(alteration.NewName, "la tabla", MessageKeys.Thing.Table, errors);
        }

        ValidateColumns(
            [.. alteration.AddedColumns, .. alteration.AlteredColumns.Select(change => change.Column)],
            errors);

        foreach (var dropped in alteration.DroppedColumns)
        {
            ValidateName(dropped, "la columna", MessageKeys.Thing.Column, errors);
        }

        foreach (var change in alteration.AlteredColumns)
        {
            ValidateName(change.CurrentName, "la columna", MessageKeys.Thing.Column, errors);
        }

        // Cambiar una columna y borrarla en el mismo lote es contradictorio, y el
        // orden en que se ejecutara decidiría el resultado.
        var touched = alteration.AlteredColumns
            .Select(change => change.CurrentName)
            .Intersect(alteration.DroppedColumns, StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (touched.Count > 0)
        {
            errors.Add(UserMessage.With(
                MessageKeys.Table.AlterAndDrop,
                $"No se puede modificar y borrar la misma columna: {string.Join(", ", touched)}.",
                "columns",
                string.Join(", ", touched)));
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
            ValidateName(change.CurrentName, "el índice", MessageKeys.Thing.Index, errors);
        }

        foreach (var name in alteration.DroppedIndexes)
        {
            ValidateName(name, "el índice", MessageKeys.Thing.Index, errors);
        }

        ValidateForeignKeys(alteration.AddedForeignKeys, known: null, errors);
        ValidateUnique(alteration.AddedUniqueConstraints, known: null, errors);
        ValidateChecks(alteration.AddedCheckConstraints, capabilities, errors);

        foreach (var name in alteration.DroppedForeignKeys
            .Concat(alteration.DroppedUniqueConstraints)
            .Concat(alteration.DroppedCheckConstraints))
        {
            ValidateName(name, "la restricción", MessageKeys.Thing.Constraint, errors);
        }

        if (alteration.NewPrimaryKey is { } primaryKey)
        {
            if (primaryKey.Name is not null)
            {
                ValidateName(primaryKey.Name, "la clave primaria", MessageKeys.Thing.PrimaryKey, errors);
            }

            if (primaryKey.Columns.Count == 0)
            {
                errors.Add(new UserMessage(
                    MessageKeys.Table.PrimaryKeyColumns,
                    "La clave primaria necesita al menos una columna."));
            }

            var borrowed = primaryKey.Columns
                .Intersect(removed, StringComparer.OrdinalIgnoreCase)
                .ToList();

            if (borrowed.Count > 0)
            {
                errors.Add(UserMessage.With(
                    MessageKeys.Table.PrimaryKeyDropped,
                    "La clave primaria no puede usar columnas que se borran en el mismo cambio: " +
                    string.Join(", ", borrowed) + ".",
                    "columns",
                    string.Join(", ", borrowed)));
            }
        }

        if (alteration.DroppedPrimaryKeyName is not null)
        {
            ValidateName(alteration.DroppedPrimaryKeyName, "la clave primaria", MessageKeys.Thing.PrimaryKey, errors);
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
        List<UserMessage> errors)
    {
        foreach (var index in indexes)
        {
            ValidateName(index.Name, "el índice", MessageKeys.Thing.Index, errors);

            if (index.Columns.Count == 0)
            {
                errors.Add(UserMessage.With(
                    MessageKeys.Table.IndexColumns,
                    $"El índice '{index.Name}' necesita al menos una columna.",
                    "index",
                    index.Name));
            }

            foreach (var column in index.Columns)
            {
                ValidateName(column.Name, "la columna del índice", MessageKeys.Thing.IndexColumn, errors);
            }

            var repeated = index.Columns
                .GroupBy(column => column.Name, StringComparer.OrdinalIgnoreCase)
                .Where(group => group.Count() > 1)
                .Select(group => group.Key)
                .ToList();

            if (repeated.Count > 0)
            {
                errors.Add(new UserMessage(
                    MessageKeys.Table.IndexRepeats,
                    $"El índice '{index.Name}' repite columnas: {string.Join(", ", repeated)}.",
                    new Dictionary<string, string>
                    {
                        ["index"] = index.Name,
                        ["columns"] = string.Join(", ", repeated),
                    }));
            }

            if (known is not null)
            {
                ValidateReferences(
                    [.. index.Columns.Select(column => column.Name), .. index.IncludedColumns],
                    known,
                    $"El índice '{index.Name}'",
                    MessageKeys.Thing.Index,
                    index.Name,
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
                errors.Add(UserMessage.With(
                    MessageKeys.Table.IndexIncluded,
                    $"El índice '{index.Name}' usa columnas incluidas y este motor no las admite.",
                    "index",
                    index.Name));
            }

            if (!string.IsNullOrWhiteSpace(index.Filter) && !capabilities.SupportsFilter)
            {
                errors.Add(UserMessage.With(
                    MessageKeys.Table.IndexFilter,
                    $"El índice '{index.Name}' usa una condición y este motor no admite índices parciales.",
                    "index",
                    index.Name));
            }

            if (!string.IsNullOrWhiteSpace(index.Method) &&
                capabilities.Methods.Count > 0 &&
                !capabilities.Methods.Contains(index.Method.Trim(), StringComparer.OrdinalIgnoreCase))
            {
                errors.Add(new UserMessage(
                    MessageKeys.Table.IndexMethod,
                    $"El índice '{index.Name}' pide la estructura '{index.Method}', que este motor no ofrece.",
                    new Dictionary<string, string>
                    {
                        ["index"] = index.Name,
                        ["method"] = index.Method,
                    }));
            }
        }

        var duplicated = indexes
            .GroupBy(index => index.Name, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();

        if (duplicated.Count > 0)
        {
            errors.Add(UserMessage.With(
                MessageKeys.Table.DuplicatedIndexes,
                $"Hay índices repetidos: {string.Join(", ", duplicated)}.",
                "indexes",
                string.Join(", ", duplicated)));
        }
    }

    private static void ValidateForeignKeys(
        IReadOnlyList<ForeignKeyDefinition> keys,
        IReadOnlyList<string>? known,
        List<UserMessage> errors)
    {
        foreach (var key in keys)
        {
            ValidateName(key.Name, "la clave foránea", MessageKeys.Thing.ForeignKey, errors);
            ValidateName(key.ReferencedTable, "la tabla referenciada", MessageKeys.Thing.ReferencedTable, errors);

            if (key.Columns.Count == 0)
            {
                errors.Add(UserMessage.With(
                    MessageKeys.Table.ForeignKeyColumns,
                    $"La clave foránea '{key.Name}' necesita al menos una columna.",
                    "key",
                    key.Name));
            }

            // Las dos listas emparejan por posición, así que distinta longitud no
            // es un descuido: es una clave que el motor rechazaría sin explicar
            // cuál de las dos sobra.
            if (key.Columns.Count != key.ReferencedColumns.Count)
            {
                errors.Add(new UserMessage(
                    MessageKeys.Table.ForeignKeyMismatch,
                    $"La clave foránea '{key.Name}' empareja {key.Columns.Count} columnas " +
                    $"con {key.ReferencedColumns.Count} referenciadas.",
                    new Dictionary<string, string>
                    {
                        ["key"] = key.Name,
                        ["own"] = key.Columns.Count.ToString(CultureInfo.InvariantCulture),
                        ["other"] = key.ReferencedColumns.Count.ToString(CultureInfo.InvariantCulture),
                    }));
            }

            foreach (var column in key.Columns.Concat(key.ReferencedColumns))
            {
                ValidateName(column, "la columna de la clave foránea", MessageKeys.Thing.ForeignKeyColumn, errors);
            }

            if (known is not null)
            {
                ValidateReferences(
                    key.Columns,
                    known,
                    $"La clave foránea '{key.Name}'",
                    MessageKeys.Thing.ForeignKey,
                    key.Name,
                    errors);
            }
        }
    }

    private static void ValidateUnique(
        IReadOnlyList<UniqueConstraintDefinition> constraints,
        IReadOnlyList<string>? known,
        List<UserMessage> errors)
    {
        foreach (var constraint in constraints)
        {
            ValidateName(constraint.Name, "la restricción de unicidad", MessageKeys.Thing.UniqueConstraint, errors);

            if (constraint.Columns.Count == 0)
            {
                errors.Add(UserMessage.With(
                    MessageKeys.Table.UniqueColumns,
                    $"La restricción '{constraint.Name}' necesita al menos una columna.",
                    "constraint",
                    constraint.Name));
            }

            foreach (var column in constraint.Columns)
            {
                ValidateName(column, "la columna de la restricción", MessageKeys.Thing.ConstraintColumn, errors);
            }

            if (known is not null)
            {
                ValidateReferences(
                    constraint.Columns,
                    known,
                    $"La restricción '{constraint.Name}'",
                    MessageKeys.Thing.UniqueConstraint,
                    constraint.Name,
                    errors);
            }
        }
    }

    private static void ValidateChecks(
        IReadOnlyList<CheckConstraintDefinition> constraints,
        IndexCapabilities? capabilities,
        List<UserMessage> errors)
    {
        foreach (var constraint in constraints)
        {
            ValidateName(constraint.Name, "la restricción de comprobación", MessageKeys.Thing.CheckConstraint, errors);

            if (string.IsNullOrWhiteSpace(constraint.Expression))
            {
                errors.Add(UserMessage.With(
                    MessageKeys.Table.CheckBody,
                    $"La restricción '{constraint.Name}' necesita una condición.",
                    "constraint",
                    constraint.Name));
            }

            if (capabilities is not null && !capabilities.SupportsCheckConstraints)
            {
                errors.Add(new UserMessage(
                    MessageKeys.Table.ChecksUnsupported,
                    "Este motor no comprueba condiciones sobre las filas."));
            }
        }
    }

    /// <summary>Comprueba que unas columnas estén entre las que la tabla declara.</summary>
    private static void ValidateReferences(
        IReadOnlyList<string> used,
        IReadOnlyList<string> known,
        string subject,
        string subjectTerm,
        string subjectName,
        List<UserMessage> errors)
    {
        var missing = used
            .Where(column => !known.Contains(column, StringComparer.OrdinalIgnoreCase))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();

        if (missing.Count > 0)
        {
            errors.Add(new UserMessage(
                MessageKeys.Table.UnknownColumns,
                $"{subject} usa columnas que la tabla no tiene: {string.Join(", ", missing)}.",
                new Dictionary<string, string>
                {
                    ["name"] = subjectName,
                    ["columns"] = string.Join(", ", missing),
                },
                new Dictionary<string, string> { ["subject"] = subjectTerm }));
        }
    }

    private static void ValidateColumns(
        IReadOnlyList<TableColumnDefinition> columns,
        List<UserMessage> errors)
    {
        foreach (var column in columns)
        {
            ValidateName(column.Name, "la columna", MessageKeys.Thing.Column, errors);

            if (string.IsNullOrWhiteSpace(column.DataType))
            {
                errors.Add(UserMessage.With(
                    MessageKeys.Table.ColumnType,
                    $"La columna '{column.Name}' necesita un tipo de dato.",
                    "column",
                    column.Name));
            }

            // Una clave primaria no admite nulos en ningún motor; dejar la casilla
            // marcada produciría un error del servidor difícil de relacionar.
            if (column.IsPrimaryKey && column.IsNullable)
            {
                errors.Add(UserMessage.With(
                    MessageKeys.Table.PrimaryKeyNullable,
                    $"La columna '{column.Name}' es clave primaria y no puede admitir nulos.",
                    "column",
                    column.Name));
            }
        }

        var duplicated = columns
            .GroupBy(column => column.Name, StringComparer.OrdinalIgnoreCase)
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();

        if (duplicated.Count > 0)
        {
            errors.Add(UserMessage.With(
                MessageKeys.Table.DuplicatedColumns,
                $"Hay columnas repetidas: {string.Join(", ", duplicated)}.",
                "columns",
                string.Join(", ", duplicated)));
        }
    }

    /// <param name="what">El nombre de la cosa en español, para el texto de respaldo.</param>
    /// <param name="term">Esa misma cosa como clave, para que se pueda traducir.</param>
    private static void ValidateName(
        string name,
        string what,
        string term,
        List<UserMessage> errors)
    {
        if (string.IsNullOrWhiteSpace(name))
        {
            errors.Add(UserMessage.WithTerm(
                MessageKeys.Table.NameRequired,
                $"El nombre de {what} es obligatorio.",
                "thing",
                term));
            return;
        }

        // Los identificadores se citan antes de escribirlos, así que un espacio o
        // un acento son legales. Un salto de línea o un nulo no: no hay forma de
        // citarlos y son la vía clásica para partir una instrucción en dos.
        if (name.IndexOfAny(ForbiddenInNames) >= 0)
        {
            errors.Add(UserMessage.WithTerm(
                MessageKeys.Table.NameNewline,
                $"El nombre de {what} no puede contener saltos de línea.",
                "thing",
                term));
        }

        if (name.Length > 128)
        {
            errors.Add(new UserMessage(
                MessageKeys.Table.NameTooLong,
                $"El nombre de {what} no puede superar 128 caracteres.",
                new Dictionary<string, string> { ["max"] = "128" },
                new Dictionary<string, string> { ["thing"] = term }));
        }
    }
}
