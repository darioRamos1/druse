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

    public static ValidationResult Validate(TableDefinition? table)
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

        // Varias columnas pueden formar una clave primaria compuesta, pero solo
        // una puede generar su valor: dos identidades no las admite ningún motor.
        if (table.Columns.Count(column => column.IsIdentity) > 1)
        {
            errors.Add("Solo una columna puede generar su valor automáticamente.");
        }

        return new ValidationResult(errors);
    }

    public static ValidationResult Validate(TableAlteration? alteration)
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

        return new ValidationResult(errors);
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
