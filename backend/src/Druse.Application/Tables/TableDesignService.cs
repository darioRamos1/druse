using Druse.Application.Abstractions;
using Druse.Application.Connections;
using Druse.Database.Abstractions;
using Druse.Domain;

namespace Druse.Application.Tables;

/// <summary>Por qué no se aplicó un cambio de estructura.</summary>
public enum TableChangeRefusal
{
    /// <summary>La conexión está marcada como solo lectura.</summary>
    ReadOnlyConnection = 0,

    /// <summary>El diseño no es válido.</summary>
    InvalidDesign = 1,

    /// <summary>Hay que confirmar antes de ejecutar.</summary>
    Unconfirmed = 2,

    /// <summary>Borra columnas y con ellas sus datos.</summary>
    Destructive = 3,
}

/// <param name="Reason">Motivo, para que el cliente sepa qué ofrecer.</param>
/// <param name="Message">Explicación pensada para enseñarla tal cual.</param>
public readonly record struct TableChangeRejection(TableChangeRefusal Reason, string Message);

public sealed class TableChangeRejectedException(TableChangeRejection rejection)
    : InvalidOperationException(rejection.Message)
{
    public TableChangeRejection Rejection { get; } = rejection;
}

/// <summary>
/// Crea y modifica tablas.
///
/// Escribe estructura, que es más difícil de deshacer que una fila, así que las
/// reglas viven **aquí** y no en la interfaz: una interfaz se puede saltar, un
/// caso de uso no.
///
/// 1. Una conexión de solo lectura no cambia estructura.
/// 2. El diseño se valida antes de escribir una sola instrucción.
/// 3. Sin confirmación no se ejecuta: el usuario tiene que haber visto el SQL.
/// 4. Borrar columnas exige una confirmación aparte, porque se lleva sus datos
///    por delante y ningún `ALTER` los devuelve.
/// </summary>
public sealed class TableDesignService(
    IProviderRegistry providers,
    ConnectionService connections)
{
    private readonly IProviderRegistry _providers = providers;
    private readonly ConnectionService _connections = connections;

    /// <summary>Tipos que ofrece el motor de esta sesión.</summary>
    public IReadOnlyList<string> DataTypes(Guid sessionId)
    {
        var session = _connections.Require(sessionId);

        return _providers.GetTableDesigner(session.Engine).CommonDataTypes;
    }

    /// <summary>El `CREATE TABLE` que se ejecutaría, sin ejecutarlo.</summary>
    public IReadOnlyList<string> PreviewCreate(Guid sessionId, TableDefinition table)
    {
        var designer = Prepare(sessionId, table);

        return designer.DescribeCreate(table);
    }

    public async Task<TableChangeResult> CreateAsync(
        Guid sessionId,
        TableDefinition table,
        bool confirmed,
        CancellationToken cancellationToken)
    {
        var designer = Prepare(sessionId, table);

        Confirm(confirmed);

        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);

        return await _connections.UseDatabaseAsync(
            session,
            table.Database,
            selected => designer.CreateAsync(selected, table, cancellationToken),
            cancellationToken);
    }

    /// <summary>Las instrucciones que cambiarían la tabla, sin ejecutarlas.</summary>
    public IReadOnlyList<string> PreviewAlter(Guid sessionId, TableAlteration alteration)
    {
        var designer = Prepare(sessionId, alteration);

        return designer.DescribeAlter(alteration);
    }

    public async Task<TableChangeResult> AlterAsync(
        Guid sessionId,
        TableAlteration alteration,
        bool confirmed,
        bool confirmedDestructive,
        CancellationToken cancellationToken)
    {
        var designer = Prepare(sessionId, alteration);

        Confirm(confirmed);

        // Borrar una columna no se puede deshacer, así que no basta con haber
        // visto el SQL: hay que decir que sí a eso en concreto.
        if (alteration.IsDestructive && !confirmedDestructive)
        {
            throw new TableChangeRejectedException(new TableChangeRejection(
                TableChangeRefusal.Destructive,
                "Se van a borrar columnas y los datos que contienen. Confirma para continuar: " +
                string.Join(", ", alteration.DroppedColumns) + "."));
        }

        using var turn = await _connections.EnterAsync(sessionId, cancellationToken);

        var session = _connections.Require(sessionId);

        return await _connections.UseDatabaseAsync(
            session,
            alteration.Table.Database,
            selected => designer.AlterAsync(selected, alteration, cancellationToken),
            cancellationToken);
    }

    private ITableDesigner Prepare(Guid sessionId, TableDefinition table)
    {
        var designer = Designer(sessionId);
        var validation = TableDesignValidator.Validate(table);

        if (!validation.IsValid)
        {
            throw new TableChangeRejectedException(new TableChangeRejection(
                TableChangeRefusal.InvalidDesign,
                string.Join(" ", validation.Errors)));
        }

        return designer;
    }

    private ITableDesigner Prepare(Guid sessionId, TableAlteration alteration)
    {
        var designer = Designer(sessionId);
        var validation = TableDesignValidator.Validate(alteration);

        if (!validation.IsValid)
        {
            throw new TableChangeRejectedException(new TableChangeRejection(
                TableChangeRefusal.InvalidDesign,
                string.Join(" ", validation.Errors)));
        }

        return designer;
    }

    private ITableDesigner Designer(Guid sessionId)
    {
        var session = _connections.Require(sessionId);

        if (session.Profile.ReadOnly)
        {
            throw new TableChangeRejectedException(new TableChangeRejection(
                TableChangeRefusal.ReadOnlyConnection,
                "La conexión está marcada como solo lectura."));
        }

        return _providers.GetTableDesigner(session.Engine);
    }

    private static void Confirm(bool confirmed)
    {
        if (!confirmed)
        {
            throw new TableChangeRejectedException(new TableChangeRejection(
                TableChangeRefusal.Unconfirmed,
                "Revisa el SQL y confirma antes de aplicar los cambios."));
        }
    }
}
