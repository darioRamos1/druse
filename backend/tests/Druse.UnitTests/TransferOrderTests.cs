using Druse.Application.Transfers;
using Druse.Domain;

namespace Druse.UnitTests;

/// <summary>
/// En qué orden se copian las tablas de una pasada.
///
/// Se prueba sin motor porque no depende de ninguno: lo que entra son las foráneas
/// que el catálogo ya leyó, y lo que sale es una lista. Y se prueba a fondo porque
/// el error que comete esto no se ve al ejecutarlo —el motor rechaza la fila y
/// parece un problema de datos—, sino leyendo el orden que salió.
/// </summary>
public sealed class TransferOrderTests
{
    /// <summary>
    /// La padre va antes que la hija, aunque se pidieran al revés.
    ///
    /// Es la razón de ser de todo esto: copiar `pedidos` antes que `clientes` no
    /// falla a veces, falla siempre que el destino tenga la foránea puesta.
    /// </summary>
    [Fact]
    public void LaPadreVaAntesQueLaHija()
    {
        var ordering = TransferOrder.Sort(
        [
            Node("pedidos", References("clientes")),
            Node("clientes"),
        ]);

        Assert.Equal([1, 0], ordering.Order);
        Assert.Empty(ordering.Cycles);
    }

    /// <summary>
    /// Una cadena de tres se ordena entera, no solo por parejas.
    ///
    /// `pedido_lineas` apunta a `pedidos` y `pedidos` a `clientes`: sin recorrer la
    /// cadena, cualquiera de los dos pares podría quedar bien y el conjunto mal.
    /// </summary>
    [Fact]
    public void LaCadenaEnteraSeOrdena()
    {
        var ordering = TransferOrder.Sort(
        [
            Node("pedido_lineas", References("pedidos")),
            Node("pedidos", References("clientes")),
            Node("clientes"),
        ]);

        Assert.Equal([2, 1, 0], ordering.Order);
    }

    /// <summary>
    /// Entre tablas que nadie obliga a separar, manda el orden en que se pidieron.
    ///
    /// Un orden que cambia de una ejecución a otra convertiría cualquier fallo a
    /// mitad en algo que no se puede reproducir: «entraron tres tablas» dejaría de
    /// decir cuáles.
    /// </summary>
    [Fact]
    public void SinForaneasSeRespetaElOrdenPedido()
    {
        var ordering = TransferOrder.Sort(
        [
            Node("monedas"),
            Node("paises"),
            Node("estados"),
        ]);

        Assert.Equal([0, 1, 2], ordering.Order);
        Assert.Empty(ordering.Cycles);
    }

    /// <summary>
    /// Lo que apunta fuera del conjunto no ordena nada.
    ///
    /// Esas tablas no se están copiando: o ya están en el destino, o el motor se
    /// quejará por su cuenta. Tratarlas como dependencias dejaría a `pedidos`
    /// esperando a una tabla que nadie va a traer.
    /// </summary>
    [Fact]
    public void LoQueApuntaFueraDelConjuntoSeIgnora()
    {
        var ordering = TransferOrder.Sort(
        [
            Node("pedidos", References("clientes", "vendedores")),
            Node("clientes"),
        ]);

        Assert.Equal([1, 0], ordering.Order);
        Assert.Empty(ordering.Cycles);
    }

    /// <summary>
    /// Una tabla que se apunta a sí misma no es un ciclo.
    ///
    /// Es la jerarquía de toda la vida —el empleado con su jefe, la categoría con
    /// su categoría padre— y avisarlo llenaría de ruido el caso más normal.
    /// </summary>
    [Fact]
    public void LaTablaQueSeApuntaASiMismaNoEsUnCiclo()
    {
        var ordering = TransferOrder.Sort(
        [
            Node("empleados", References("empleados")),
            Node("cargos"),
        ]);

        Assert.Empty(ordering.Cycles);
        Assert.Equal(2, ordering.Order.Count);
    }

    /// <summary>
    /// Dos tablas que se apuntan la una a la otra se avisan y se copian igual.
    ///
    /// Con un ciclo no hay orden que las satisfaga a la vez, y elegir uno callando
    /// sería fingir que sí. Van al final, en el orden en que se pidieron.
    /// </summary>
    [Fact]
    public void ElCicloSeAvisaYNoSeInventaUnOrden()
    {
        var ordering = TransferOrder.Sort(
        [
            Node("empleados", References("departamentos")),
            Node("departamentos", References("empleados")),
            Node("cargos"),
        ]);

        Assert.Equal(["public.empleados", "public.departamentos"], ordering.Cycles);

        // Las tres se copian igual: avisar no es negarse.
        Assert.Equal(3, ordering.Order.Count);
        Assert.Equal([0, 1, 2], [.. ordering.Order.Order()]);

        // Y la que no está en el ciclo va primero, porque de ella sí se sabe.
        Assert.Equal(2, ordering.Order[0]);
    }

    /// <summary>
    /// Lo que cuelga de un ciclo también queda sin ordenar, y se dice.
    ///
    /// No se puede prometer que llegue después de sus padres si sus padres no
    /// tienen un orden entre ellos.
    /// </summary>
    [Fact]
    public void LoQueCuelgaDeUnCicloTampocoSePuedeOrdenar()
    {
        var ordering = TransferOrder.Sort(
        [
            Node("a", References("b")),
            Node("b", References("a")),
            Node("c", References("a")),
        ]);

        Assert.Equal(["public.a", "public.b", "public.c"], ordering.Cycles);
    }

    /// <summary>
    /// El mismo nombre en dos esquemas son dos tablas distintas.
    ///
    /// Una foránea no dice de qué base viene, así que se busca por esquema y
    /// nombre: si no, copiar `ventas.pedidos` y `compras.pedidos` en la misma
    /// pasada las confundiría y el orden saldría de la que no era.
    /// </summary>
    [Fact]
    public void ElEsquemaDistingueDosTablasConElMismoNombre()
    {
        var ordering = TransferOrder.Sort(
        [
            Node("pedidos", References("clientes"), schema: "ventas"),
            Node("pedidos", schema: "compras"),
            Node("clientes", schema: "ventas"),
        ]);

        // La de `ventas` espera a su cliente; la de `compras` no espera a nadie.
        Assert.Equal([1, 2, 0], ordering.Order);
        Assert.Empty(ordering.Cycles);
    }

    /// <summary>Una sola tabla no se ordena ni se lee: no hay nada que decidir.</summary>
    [Fact]
    public void UnaSolaTablaSaleTalCualLlego()
    {
        var ordering = TransferOrder.Sort([Node("pedidos", References("clientes"))]);

        Assert.Equal([0], ordering.Order);
        Assert.Empty(ordering.Cycles);
    }

    private static TransferNode Node(
        string name,
        IReadOnlyList<DatabaseForeignKey>? foreignKeys = null,
        string schema = "public") =>
        new(
            new DatabaseObject
            {
                Id = $"{schema}.{name}",
                Name = name,
                Kind = DatabaseObjectKind.Table,
                Schema = schema,
            },
            foreignKeys ?? []);

    private static IReadOnlyList<DatabaseForeignKey> References(params string[] tables) =>
        [
            .. tables.Select(table => new DatabaseForeignKey
            {
                Name = $"fk_{table}",
                Columns = ["id"],
                ReferencedTable = table,
                ReferencedColumns = ["id"],
            }),
        ];
}
