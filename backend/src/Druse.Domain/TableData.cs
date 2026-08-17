namespace Druse.Domain;

/// <summary>
/// Qué se lleva un respaldo de una tabla.
///
/// Es el interruptor que se pidió: estructura, estructura y datos, o solo datos.
/// Vive en el dominio y no en la interfaz porque gobierna lo que se escribe, y
/// porque el mismo valor viaja al perfil guardado.
/// </summary>
public enum TableDataMode
{
    /// <summary>La tabla vacía: su definición y nada más.</summary>
    StructureOnly = 0,

    /// <summary>La tabla y sus filas.</summary>
    StructureAndData = 1,

    /// <summary>
    /// Solo las filas, para recargar una base cuya estructura ya está puesta.
    /// </summary>
    DataOnly = 2,
}

/// <summary>Qué filas y qué columnas de una tabla entran en el respaldo.</summary>
public sealed record TableDataFilter
{
    /// <summary>Todas las filas y todas las columnas.</summary>
    public static readonly TableDataFilter None = new();

    /// <summary>
    /// Condición que limita las filas, escrita a mano y sin el `WHERE` delante.
    ///
    /// Es la única entrada de texto libre de un respaldo, así que se comprueba
    /// antes de pegarla a nada: ver <see cref="Validate"/>.
    /// </summary>
    public string? Where { get; init; }

    /// <summary>Tope de filas, para sacar muestras de desarrollo.</summary>
    public int? MaxRows { get; init; }

    /// <summary>
    /// Columnas que no se copian: contraseñas, datos personales.
    ///
    /// No se escriben en el `INSERT`, de modo que la fila restaurada las recibe
    /// como su valor por omisión —o como nulo si no lo tiene—, que es justo lo
    /// que se quiere al llevarse una tabla sin sus datos sensibles.
    /// </summary>
    public IReadOnlyList<string> ExcludedColumns { get; init; } = [];

    public bool IsEmpty =>
        string.IsNullOrWhiteSpace(Where) && MaxRows is null && ExcludedColumns.Count == 0;

    /// <summary>
    /// Comprueba el filtro contra la tabla a la que se aplica.
    ///
    /// Se hace aquí y no en la interfaz por lo mismo que las reglas del diseñador:
    /// una interfaz se puede saltar, y esto decide qué SQL se arma y qué datos
    /// salen de la base.
    /// </summary>
    /// <returns>Los problemas encontrados. Vacío significa que el filtro sirve.</returns>
    public IReadOnlyList<string> Validate(ScriptedTable table)
    {
        ArgumentNullException.ThrowIfNull(table);

        var problems = new List<string>();

        if (MaxRows is <= 0)
        {
            problems.Add("El límite de filas tiene que ser mayor que cero.");
        }

        if (!string.IsNullOrWhiteSpace(Where))
        {
            problems.AddRange(WhereProblems(Where));
        }

        foreach (var name in ExcludedColumns)
        {
            var column = table.Columns.FirstOrDefault(item =>
                string.Equals(item.Name, name, StringComparison.Ordinal));

            if (column is null)
            {
                problems.Add($"La columna «{name}» no existe en la tabla.");
                continue;
            }

            // Excluir una columna obligatoria que no tiene valor por omisión deja
            // un `INSERT` que el motor rechaza. Se dice al marcarla, no al fallar
            // el respaldo tres horas después.
            if (!column.IsNullable && column.DefaultValue is null && !column.IsGenerated)
            {
                problems.Add(
                    $"La columna «{name}» es obligatoria y no tiene valor por omisión: " +
                    "excluirla dejaría filas que el motor rechaza al restaurarlas.");
            }
        }

        if (ExcludedColumns.Count > 0 &&
            table.Columns.All(column => ExcludedColumns.Contains(column.Name, StringComparer.Ordinal)))
        {
            problems.Add("No se pueden excluir todas las columnas de la tabla.");
        }

        return problems;
    }

    /// <summary>
    /// Lo que no se admite en una condición escrita a mano.
    ///
    /// La condición acaba dentro de un `SELECT` que arma Druse, así que aquí se
    /// mira lo que la sacaría de ahí: **el punto y coma**, que convertiría el
    /// filtro en una segunda instrucción, y cualquier palabra que escriba. Es la
    /// misma regla del plan §12, aplicada al único texto libre que tiene un
    /// respaldo.
    ///
    /// No pretende ser un analizador de SQL: la última palabra la tiene el motor,
    /// que rechazará lo que no entienda. Sirve para que un descuido no se
    /// convierta en una instrucción que nadie quiso ejecutar.
    /// </summary>
    private static IEnumerable<string> WhereProblems(string where)
    {
        if (where.Contains(';', StringComparison.Ordinal))
        {
            yield return "La condición no puede llevar «;»: sería una segunda instrucción.";
        }

        if (SqlSafetyAnalyzer.IsMutating(where))
        {
            yield return "La condición no puede contener instrucciones que escriban.";
        }
    }
}

/// <summary>
/// Lo que el usuario decidió sobre los datos: el interruptor general y lo que se
/// sale de él.
///
/// Los dos niveles existen porque el caso que justifica la función es «todo sin
/// datos, **salvo** estas tres tablas». Con un solo interruptor harían falta dos
/// respaldos, y con solo anulaciones habría que marcar tabla por tabla.
/// </summary>
public sealed record DataSelection
{
    /// <summary>Lo que se aplica a las tablas que no dicen otra cosa.</summary>
    public TableDataMode Default { get; init; } = TableDataMode.StructureAndData;

    /// <summary>
    /// Lo que cada tabla decide por su cuenta, por su nombre calificado.
    ///
    /// La clave es el nombre y no el identificador de la sesión: un perfil
    /// guardado se abre meses después, contra otra conexión, y para entonces
    /// ningún identificador de sesión significa nada.
    /// </summary>
    public IReadOnlyDictionary<string, TableDataMode> Overrides { get; init; } =
        new Dictionary<string, TableDataMode>(StringComparer.Ordinal);

    /// <summary>Filtros por tabla, con la misma clave que las anulaciones.</summary>
    public IReadOnlyDictionary<string, TableDataFilter> Filters { get; init; } =
        new Dictionary<string, TableDataFilter>(StringComparer.Ordinal);

    /// <summary>
    /// Nombre con el que una tabla se identifica dentro de una selección.
    ///
    /// Lleva el esquema cuando lo hay porque dos esquemas pueden tener una tabla
    /// con el mismo nombre, y en MySQL —donde el esquema es la base— hace de
    /// esquema el contenedor que traiga el objeto.
    /// </summary>
    public static string KeyOf(DatabaseObject table)
    {
        ArgumentNullException.ThrowIfNull(table);

        var container = !string.IsNullOrWhiteSpace(table.Schema) ? table.Schema : table.Database;

        return string.IsNullOrWhiteSpace(container) ? table.Name : $"{container}.{table.Name}";
    }

    public TableDataMode ModeOf(DatabaseObject table) =>
        Overrides.TryGetValue(KeyOf(table), out var mode) ? mode : Default;

    public TableDataFilter FilterOf(DatabaseObject table) =>
        Filters.TryGetValue(KeyOf(table), out var filter) ? filter : TableDataFilter.None;

    /// <summary>Si de esta tabla hay que escribir filas.</summary>
    public bool IncludesData(DatabaseObject table) =>
        ModeOf(table) is TableDataMode.StructureAndData or TableDataMode.DataOnly;

    /// <summary>Si de esta tabla hay que escribir su definición.</summary>
    public bool IncludesStructure(DatabaseObject table) =>
        ModeOf(table) is TableDataMode.StructureOnly or TableDataMode.StructureAndData;

    /// <summary>
    /// Tablas que se salen del interruptor general.
    ///
    /// La interfaz las señala: sin verlas de un vistazo, nadie sabe qué va a
    /// obtener de un respaldo con anulaciones.
    /// </summary>
    public IReadOnlyList<string> Exceptions() =>
        [.. Overrides.Where(entry => entry.Value != Default).Select(entry => entry.Key).Order(StringComparer.Ordinal)];
}
