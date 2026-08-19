using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Application.Metadata;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Rows;

/// <summary>Petición de importación, ya con el archivo leído.</summary>
public sealed record ImportRequest
{
    public required Guid SessionId { get; init; }

    public required DatabaseObject Table { get; init; }

    public required TableFile File { get; init; }

    /// <summary>Si viene vacío, se emparejan las columnas por nombre.</summary>
    public IReadOnlyList<ColumnMapping> Mappings { get; init; } = [];

    /// <summary>El usuario ya vio qué se iba a insertar.</summary>
    public bool Confirmed { get; init; }
}

/// <summary>Un valor del archivo que no cabe en su columna.</summary>
/// <param name="Row">Fila del archivo, empezando en 1 sin contar la cabecera.</param>
public sealed record ImportProblem(int Row, string Column, string Message);

/// <summary>Lo que se sabe antes de importar nada.</summary>
public sealed record ImportPreview
{
    public required IReadOnlyList<ColumnMapping> Mappings { get; init; }

    /// <summary>Columnas de la tabla que nadie llena y que no admiten nulo.</summary>
    public required IReadOnlyList<string> MissingRequired { get; init; }

    public required IReadOnlyList<ImportProblem> Problems { get; init; }

    public required int RowCount { get; init; }

    /// <summary>Las primeras instrucciones, para verlas antes de aceptar.</summary>
    public required IReadOnlyList<string> Statements { get; init; }
}

/// <summary>
/// Mete el contenido de un archivo en una tabla.
///
/// El orden importa: **primero se cuenta lo que va a pasar y solo después se
/// escribe**. Importar a ciegas es la operación que más datos estropea de
/// cuantas hace una herramienta como esta, porque falla en silencio: una columna
/// desplazada convierte teléfonos en códigos postales y nadie se entera hasta
/// mucho después.
///
/// Por eso la previsualización no es un adorno: revisa **todas** las filas que se
/// van a insertar, no una muestra, y enumera lo que no cabe con su número de
/// fila y su columna.
/// </summary>
public sealed class ImportService(
    IProviderRegistry providers,
    ConnectionService connections,
    MetadataService metadata)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;
    private readonly MetadataService _metadata = metadata;

    /// <summary>Qué se insertaría y qué no cabe, sin tocar la tabla.</summary>
    public async Task<ImportPreview> PreviewAsync(
        ImportRequest request,
        CancellationToken cancellationToken)
    {
        var (_, plan, problems, missing, statements) =
            await PrepareAsync(request, requireConfirmation: false, cancellationToken);

        return new ImportPreview
        {
            Mappings = plan.Mappings,
            MissingRequired = missing,
            Problems = problems,
            RowCount = plan.Batch.Rows.Count,
            Statements = statements,
        };
    }

    /// <summary>Inserta las filas. Todas o ninguna.</summary>
    public async Task<RowEditResult> ImportAsync(
        ImportRequest request,
        CancellationToken cancellationToken)
    {
        var (editor, plan, problems, _, _) =
            await PrepareAsync(request, requireConfirmation: true, cancellationToken);

        if (problems.Count > 0)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.UnknownColumn,
                $"Hay {problems.Count} valores que no caben en su columna. Revísalos antes de importar."));
        }

        using var turn = await _connections.EnterAsync(request.SessionId, cancellationToken);

        var session = _connections.Require(request.SessionId);

        return await _connections.UseDatabaseAsync(
            session,
            request.Table.Database,
            selected => editor.InsertAsync(selected, plan.Batch, cancellationToken),
            cancellationToken);
    }

    private sealed record Plan(IReadOnlyList<ColumnMapping> Mappings, PreparedInsertBatch Batch);

    private async Task<(
        IRowEditor Editor,
        Plan Plan,
        IReadOnlyList<ImportProblem> Problems,
        IReadOnlyList<string> MissingRequired,
        IReadOnlyList<string> Statements)> PrepareAsync(
        ImportRequest request,
        bool requireConfirmation,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(request);

        var session = _connections.Require(request.SessionId);

        if (session.Profile.ReadOnly)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.ReadOnlyConnection,
                "La conexión está marcada como solo lectura."));
        }

        if (request.File.Rows.Count == 0)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.NothingToDo,
                "El archivo no tiene ninguna fila que importar."));
        }

        if (requireConfirmation && !request.Confirmed)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.Unconfirmed,
                "Hay que confirmar la importación antes de escribir en la tabla."));
        }

        var columns = await _metadata.GetColumnsAsync(request.SessionId, request.Table, cancellationToken);
        var byName = columns.ToDictionary(column => column.Name, StringComparer.OrdinalIgnoreCase);

        var mappings = Resolve(request, columns);
        var usadas = mappings
            .Where(mapping => mapping.Target is not null)
            .Select(mapping => mapping.Target!)
            .ToList();

        if (usadas.Count == 0)
        {
            throw new RowEditRejectedException(new RowEditRejection(
                RowEditRefusal.UnknownColumn,
                "Ninguna columna del archivo se corresponde con una de la tabla."));
        }

        // Columnas obligatorias que nadie llena. No se impide importar —la tabla
        // puede tener un valor por defecto— pero se dice, porque es la causa más
        // común de que el motor rechace el lote entero.
        var missing = columns
            .Where(column =>
                !column.IsNullable &&
                column.DefaultValue is null &&
                !usadas.Contains(column.Name, StringComparer.OrdinalIgnoreCase))
            .Select(column => column.Name)
            .ToList();

        // La conversión es la misma que usa la restauración de un respaldo en CSV:
        // las dos tienen delante celdas de texto y una tabla con sus tipos, y dos
        // criterios distintos sobre qué es un nulo solo se verían en los datos.
        var plan = RowBatchPlanner.Prepare(
            request.Table.Schema,
            request.Table.Name,
            [.. mappings.Select(mapping => mapping.Target is null ? null : byName[mapping.Target])],
            request.File.Rows);

        // Se anotan todos y se sigue: quien importa quiere la lista completa de lo
        // que está mal, no el primer fallo y a empezar de nuevo.
        var problems = plan.Problems
            .Select(problem => new ImportProblem((int)problem.Row, problem.Column, problem.Message))
            .ToList();

        var editor = _providers.GetRowEditor(session.Engine);

        return (
            editor,
            new Plan(mappings, plan.Batch),
            problems,
            missing,
            problems.Count == 0 ? [.. editor.DescribeInsert(plan.Batch).Take(5)] : []);
    }

    /// <summary>
    /// Decide qué columna del archivo va a cuál de la tabla.
    ///
    /// Si el usuario no dijo nada, se emparejan por nombre sin distinguir
    /// mayúsculas. Lo que no case se deja fuera en lugar de colocarlo por
    /// posición: adivinar ahí es exactamente como se importan teléfonos en la
    /// columna del código postal.
    /// </summary>
    private static List<ColumnMapping> Resolve(
        ImportRequest request,
        IReadOnlyList<DatabaseColumn> columns)
    {
        if (request.Mappings.Count > 0)
        {
            var válidas = columns.Select(column => column.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);

            foreach (var mapping in request.Mappings.Where(m => m.Target is not null))
            {
                if (!válidas.Contains(mapping.Target!))
                {
                    throw new RowEditRejectedException(new RowEditRejection(
                        RowEditRefusal.UnknownColumn,
                        $"La tabla no tiene ninguna columna «{mapping.Target}»."));
                }
            }

            return [.. request.Mappings];
        }

        return [.. request.File.Columns.Select(source => new ColumnMapping(
            source,
            columns.FirstOrDefault(column =>
                string.Equals(column.Name, source, StringComparison.OrdinalIgnoreCase))?.Name))];
    }
}
