using Druse.Application.Abstractions;
using Druse.Domain;

namespace Druse.Application.Transfers;

/// <summary>Cuánto se conserva de un tipo al llevarlo a otro motor.</summary>
public enum TranslationFidelity
{
    /// <summary>El destino guarda exactamente lo mismo.</summary>
    Exact = 0,

    /// <summary>
    /// Los datos caben, pero algo del tipo no viaja.
    ///
    /// Es el caso interesante y el que hay que enseñar: un `jsonb` que llega como
    /// texto sigue teniendo dentro el mismo JSON, pero el destino ya no comprueba
    /// que lo sea.
    /// </summary>
    Approximate = 1,

    /// <summary>
    /// El destino no tiene dónde meterlo sin perder datos.
    ///
    /// No se traduce a la fuerza: se dice, y quien traslada decide si excluye la
    /// columna o cambia el tipo a mano.
    /// </summary>
    None = 2,
}

/// <summary>Cómo queda una columna al cambiar de motor.</summary>
/// <param name="Column">Columna del origen.</param>
/// <param name="SourceType">Tipo tal y como lo nombra el motor de origen.</param>
/// <param name="TargetType">Tipo propuesto para el destino.</param>
/// <param name="Note">Qué se pierde. Vacío cuando no se pierde nada.</param>
public sealed record TypeTranslation(
    string Column,
    string SourceType,
    string TargetType,
    TranslationFidelity Fidelity,
    string? Note = null);

/// <summary>
/// Traduce los tipos de un motor a los de otro, diciendo qué se pierde por el
/// camino.
///
/// **Los avisos son el producto, no el tipo propuesto.** Una traducción
/// silenciosa es la que estropea datos: acertar con el nombre del tipo es fácil,
/// y lo que hace falta saber antes de copiar es qué deja de ser cierto en el
/// destino —que un identificador único ya no se valide, que una marca de tiempo
/// pierda la zona, que un texto tenga ahora un límite que antes no tenía—.
///
/// Vive en la capa de aplicación y trabaja sobre <see cref="DatabaseEngine"/> como
/// dato, no sobre proveedores: las reglas de arquitectura prohíben que un motor
/// conozca a otro, y aquí precisamente hay que mirarlos de dos en dos. Lo que se
/// le pide a cada uno son dos cosas y las dos las contesta él: cómo llama a un
/// tipo, por su <see cref="Druse.Database.Abstractions.ITableDesigner"/>, y qué
/// familias guarda con un tipo propio, por sus
/// <see cref="EngineCapabilities"/>.
///
/// **Aquí no se nombra ningún motor.** Antes sí: una tabla decía qué conservaba
/// cada uno, y su rama final —«cualquier otro motor lo conserva»— daba a un
/// motor recién añadido la respuesta más optimista posible. El aviso se perdía
/// en silencio, que es justo lo contrario de lo que hace falta cuando el aviso
/// es el producto.
/// </summary>
public sealed class TypeTranslator(IProviderRegistry providers)
{
    private readonly IProviderRegistry _providers = providers;

    /// <summary>
    /// Qué tipo tendría cada columna del origen en el motor de destino.
    /// </summary>
    /// <param name="overrides">
    /// Tipos que el usuario escribió a mano, por nombre de columna del origen.
    ///
    /// Se respetan tal cual y se marcan como exactos: quien los escribe sabe algo
    /// que el traductor no, y discutírselo con un aviso sería ruido.
    /// </param>
    public IReadOnlyList<TypeTranslation> Translate(
        DatabaseEngine source,
        DatabaseEngine target,
        IReadOnlyList<DatabaseColumn> columns,
        IReadOnlyDictionary<string, string>? overrides = null)
    {
        ArgumentNullException.ThrowIfNull(columns);

        var designer = _providers.GetTableDesigner(target);
        var capabilities = _providers.GetProvider(target).Capabilities;

        return
        [
            .. columns.Select(column =>
            {
                if (overrides is not null &&
                    overrides.TryGetValue(column.Name, out var chosen) &&
                    !string.IsNullOrWhiteSpace(chosen))
                {
                    return new TypeTranslation(
                        column.Name,
                        column.DataType,
                        chosen.Trim(),
                        TranslationFidelity.Exact);
                }

                // Dentro del mismo motor no hay nada que traducir, y proponer un
                // tipo equivalente sería cambiar una columna sin motivo: un
                // `smallint` no tiene por qué convertirse en `bigint` porque los
                // dos guarden enteros.
                if (source == target)
                {
                    return new TypeTranslation(
                        column.Name,
                        column.DataType,
                        column.DataType,
                        TranslationFidelity.Exact);
                }

                var facets = TypeFacets.Parse(column.DataType);
                var proposed = designer.TypeFor(facets);

                return Judge(column, facets, proposed, target, capabilities);
            }),
        ];
    }

    /// <summary>
    /// Decide cuánto se conserva y lo explica.
    ///
    /// El orden de las preguntas va de lo que más duele a lo que menos: primero
    /// lo que no cabe, luego lo que cabe pero deja de comprobarse, y al final lo
    /// que solo cambia de nombre.
    /// </summary>
    private static TypeTranslation Judge(
        DatabaseColumn column,
        TypeFacets facets,
        string proposed,
        DatabaseEngine target,
        EngineCapabilities capabilities)
    {
        TypeTranslation With(TranslationFidelity fidelity, string? note = null) =>
            new(column.Name, column.DataType, proposed, fidelity, note);

        // Una columna que guarda varios valores casi nunca tiene equivalente.
        // Meterla como texto convertiría «tres etiquetas» en la cadena que las
        // representa, y nadie volvería a leerlas como tres.
        if (facets.IsArray && !capabilities.StoresArrays)
        {
            return With(
                TranslationFidelity.None,
                $"{target} no tiene columnas que guarden varios valores. Copiarla como " +
                "texto dejaría dentro la representación del conjunto, no sus elementos: " +
                "conviene excluir la columna o repartirla en otra tabla.");
        }

        if (facets.IsJson && !capabilities.StoresJson)
        {
            return With(
                TranslationFidelity.Approximate,
                "El JSON viaja entero, pero el destino lo guarda como texto: deja de " +
                "comprobar que lo sea y de poder consultarlo por sus campos.");
        }

        if (facets.Family == ColumnFamily.Uuid && !capabilities.Stores(ColumnFamily.Uuid))
        {
            return With(
                TranslationFidelity.Approximate,
                "El identificador se guarda escrito, con sus 36 caracteres. Se lee igual, " +
                "pero ocupa más y el motor ya no comprueba que sea un identificador.");
        }

        if (facets.Family == ColumnFamily.TimestampWithZone
            && !capabilities.Stores(ColumnFamily.TimestampWithZone))
        {
            return With(
                TranslationFidelity.Approximate,
                "El destino no guarda la zona horaria junto a la marca de tiempo. El " +
                "instante se conserva, pero de qué huso venía se pierde.");
        }

        if (facets.Family == ColumnFamily.Boolean && !capabilities.Stores(ColumnFamily.Boolean))
        {
            return With(
                TranslationFidelity.Approximate,
                "No hay tipo booleano: los valores llegan como 1 y 0. Siguen significando " +
                "lo mismo, pero se leen como números.");
        }

        // Lo que era ilimitado y llega con tope: cabe hoy y puede no caber mañana.
        if (facets.IsUnbounded && Limit(proposed) is { } limit)
        {
            return With(
                TranslationFidelity.Approximate,
                $"En el origen no tenía límite de longitud y aquí queda con {limit} " +
                "caracteres. Lo que hay ahora cabe; lo que se escriba después, quizá no.");
        }

        return With(TranslationFidelity.Exact);
    }

    /// <summary>El tope declarado de un tipo, si lo declara y no es «sin límite».</summary>
    private static int? Limit(string dataType)
    {
        var facets = TypeFacets.Parse(dataType);

        return facets.IsUnbounded ? null : facets.Length;
    }
}
