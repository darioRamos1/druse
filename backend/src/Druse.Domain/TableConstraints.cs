namespace Druse.Domain;

/// <summary>
/// Clase de restricción, para saber cómo soltarla.
///
/// Existe porque MySQL exige nombrar el tipo al borrar —`DROP FOREIGN KEY`,
/// `DROP INDEX`, `DROP CHECK`— donde PostgreSQL y SQL Server aceptan un
/// `DROP CONSTRAINT` que sirve para todas.
/// </summary>
public enum ConstraintKind
{
    PrimaryKey = 0,
    ForeignKey = 1,
    Unique = 2,
    Check = 3,
}

/// <summary>Sentido en el que se recorre una columna dentro de un índice.</summary>
public enum IndexSortDirection
{
    Ascending = 0,
    Descending = 1,
}

/// <summary>
/// Qué hace el motor con las filas hijas cuando la fila padre se borra o cambia
/// de clave.
/// </summary>
public enum ForeignKeyAction
{
    /// <summary>Rechaza la operación. Es lo que hacen los tres motores si no se dice otra cosa.</summary>
    NoAction = 0,

    /// <summary>Repite el borrado o el cambio en las filas hijas.</summary>
    Cascade = 1,

    /// <summary>Deja la columna a nulo. Exige que la columna admita nulos.</summary>
    SetNull = 2,

    /// <summary>Deja la columna en su valor por defecto.</summary>
    SetDefault = 3,
}

/// <summary>Una columna dentro de un índice, con el sentido en que se ordena.</summary>
public sealed record IndexColumn
{
    public required string Name { get; init; }

    public IndexSortDirection Direction { get; init; } = IndexSortDirection.Ascending;
}

/// <summary>
/// Índice que se quiere tener.
///
/// Las opciones que no comparten los tres motores viven aquí como campos
/// opcionales, no como texto libre: un proveedor que no las soporta las ignora
/// y el validador las rechaza antes de escribir nada. Guardarlas como SQL ya
/// escrito habría convertido este camino en una vía para ejecutar cualquier cosa.
/// </summary>
public sealed record IndexDefinition
{
    public required string Name { get; init; }

    public required IReadOnlyList<IndexColumn> Columns { get; init; }

    /// <summary>El índice no admite valores repetidos.</summary>
    public bool IsUnique { get; init; }

    /// <summary>
    /// Columnas que se guardan en la hoja del índice sin formar parte de su clave.
    /// Solo SQL Server y PostgreSQL las admiten.
    /// </summary>
    public IReadOnlyList<string> IncludedColumns { get; init; } = [];

    /// <summary>
    /// Condición que limita las filas indizadas, ya escrita en SQL.
    ///
    /// Es la única parte que no se puede citar por el proveedor, igual que el
    /// valor por defecto de una columna: `estado = 'activo'` mezcla identificador,
    /// operador y literal, y cada uno se escribe distinto.
    /// </summary>
    public string? Filter { get; init; }

    /// <summary>
    /// Estructura del índice cuando el motor ofrece varias: `btree`, `gin`, `hash`.
    /// El proveedor comprueba que el valor esté entre los que declara.
    /// </summary>
    public string? Method { get; init; }
}

/// <summary>Clave foránea que se quiere tener.</summary>
public sealed record ForeignKeyDefinition
{
    public required string Name { get; init; }

    /// <summary>Columnas de esta tabla, en el orden en que emparejan con las referenciadas.</summary>
    public required IReadOnlyList<string> Columns { get; init; }

    /// <summary>Base de la tabla referenciada. Normalmente la misma, y entonces sobra.</summary>
    public string? ReferencedDatabase { get; init; }

    public string? ReferencedSchema { get; init; }

    public required string ReferencedTable { get; init; }

    /// <summary>Columnas de la tabla referenciada, emparejadas por posición con <see cref="Columns"/>.</summary>
    public required IReadOnlyList<string> ReferencedColumns { get; init; }

    public ForeignKeyAction OnDelete { get; init; } = ForeignKeyAction.NoAction;

    public ForeignKeyAction OnUpdate { get; init; } = ForeignKeyAction.NoAction;
}

/// <summary>Restricción de unicidad sobre una o varias columnas.</summary>
public sealed record UniqueConstraintDefinition
{
    public required string Name { get; init; }

    public required IReadOnlyList<string> Columns { get; init; }
}

/// <summary>
/// Condición que toda fila debe cumplir.
///
/// La expresión va como texto por lo mismo que el filtro de un índice: no hay
/// forma de componerla desde partes citables sin construir medio dialecto SQL.
/// </summary>
public sealed record CheckConstraintDefinition
{
    public required string Name { get; init; }

    public required string Expression { get; init; }
}

/// <summary>
/// Clave primaria como restricción con nombre.
///
/// Existe aparte de la casilla `IsPrimaryKey` de cada columna porque cambiar la
/// clave de una tabla que ya la tiene no es marcar una casilla: hay que soltar
/// la que hay, con su nombre, antes de poner la nueva.
/// </summary>
public sealed record PrimaryKeyDefinition
{
    /// <summary>Nombre de la restricción. Si falta, lo pone el motor.</summary>
    public string? Name { get; init; }

    public required IReadOnlyList<string> Columns { get; init; }
}

/// <summary>
/// Lo que el motor admite al definir un índice.
///
/// Cada proveedor la declara y la interfaz dibuja el formulario a partir de
/// ella. Es lo que permite ofrecer `INCLUDE` en SQL Server y `USING gin` en
/// PostgreSQL sin que ningún componente pregunte por el motor: preguntar por el
/// motor en la vista es exactamente lo que el plan §14 prohíbe.
/// </summary>
public sealed record IndexCapabilities
{
    /// <summary>Columnas guardadas en la hoja sin formar parte de la clave.</summary>
    public bool SupportsIncludedColumns { get; init; }

    /// <summary>Índices que solo cubren las filas que cumplen una condición.</summary>
    public bool SupportsFilter { get; init; }

    /// <summary>Sentido de ordenación por columna dentro del índice.</summary>
    public bool SupportsSortDirection { get; init; } = true;

    /// <summary>Estructuras disponibles. Vacío si el motor solo ofrece una.</summary>
    public IReadOnlyList<string> Methods { get; init; } = [];

    /// <summary>El motor sabe comprobar condiciones arbitrarias sobre cada fila.</summary>
    public bool SupportsCheckConstraints { get; init; } = true;

    /// <summary>Acciones admitidas al borrar la fila padre.</summary>
    public IReadOnlyList<ForeignKeyAction> ForeignKeyActions { get; init; } =
    [
        ForeignKeyAction.NoAction,
        ForeignKeyAction.Cascade,
        ForeignKeyAction.SetNull,
        ForeignKeyAction.SetDefault,
    ];
}
