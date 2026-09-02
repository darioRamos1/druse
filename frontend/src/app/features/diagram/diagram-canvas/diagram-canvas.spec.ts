import { ComponentFixture, TestBed } from '@angular/core/testing';

import { DatabaseObject, SchemaGraph, TableDetail } from '../../../shared/models/workspace';
import { DiagramCanvas } from './diagram-canvas';

function table(name: string): DatabaseObject {
  return {
    id: `ventas.${name}`,
    name,
    kind: 'table',
    database: 'druse_test',
    schema: 'ventas',
    hasChildren: true,
  };
}

function column(name: string, options: { pk?: boolean; nullable?: boolean } = {}) {
  return {
    name,
    dataType: 'int8',
    inputKind: 'integer' as const,
    isNullable: options.nullable ?? false,
    isPrimaryKey: options.pk ?? false,
    isGenerated: false,
    ordinal: 1,
  };
}

function detail(
  name: string,
  columns: ReturnType<typeof column>[],
  foreignKeys: { name: string; columns: string[]; referencedTable: string }[] = [],
  primaryKey?: string[],
): TableDetail {
  return {
    table: table(name),
    columns,
    structure: {
      primaryKey: primaryKey ? { name: `pk_${name}`, columns: primaryKey } : undefined,
      indexes: [],
      foreignKeys: foreignKeys.map((key) => ({
        name: key.name,
        columns: key.columns,
        referencedSchema: 'ventas',
        referencedTable: key.referencedTable,
        referencedColumns: ['id'],
        onDelete: 'noAction' as const,
        onUpdate: 'noAction' as const,
      })),
      uniqueConstraints: [],
      checkConstraints: [],
    },
  };
}

const grafo: SchemaGraph = {
  tables: [
    detail('cliente', [column('id', { pk: true }), column('nombre')], [], ['id']),
    detail(
      'factura',
      [column('id', { pk: true }), column('cliente_id'), column('total')],
      [{ name: 'fk_factura_cliente', columns: ['cliente_id'], referencedTable: 'cliente' }],
      ['id'],
    ),
    detail('bitacora', [column('id', { pk: true }), column('mensaje')], [], ['id']),
  ],
  missing: [],
};

describe('DiagramCanvas', () => {
  let fixture: ComponentFixture<DiagramCanvas>;

  const dom = (): HTMLElement => fixture.nativeElement as HTMLElement;

  const nodos = (): HTMLElement[] => [...dom().querySelectorAll<HTMLElement>('.node')];

  const cabecera = (name: string): HTMLElement => {
    const nodo = nodos().find((node) => node.querySelector('.node__name')?.textContent?.trim() === name);

    if (!nodo) {
      throw new Error(`No se dibujó la tabla ${name}.`);
    }

    return nodo.querySelector<HTMLElement>('.node__head')!;
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [DiagramCanvas] }).compileComponents();

    fixture = TestBed.createComponent(DiagramCanvas);
    fixture.componentRef.setInput('graph', grafo);
    fixture.detectChanges();
  });

  /**
   * El diagrama de una base entera trae tablas de varios esquemas, y dos que se
   * llamen igual se dibujan como dos cajas idénticas: sin el esquema delante,
   * una flecha entre ellas no dice a cuál llega.
   */
  describe('tablas que se llaman igual', () => {
    /** El mismo `cliente` en dos esquemas, más una tabla que no se repite. */
    const repetido: SchemaGraph = {
      tables: [
        detail('cliente', [column('id', { pk: true })], [], ['id']),
        {
          ...detail('cliente', [column('id', { pk: true })], [], ['id']),
          table: {
            id: 'compras.cliente',
            name: 'cliente',
            kind: 'table',
            database: 'druse_test',
            schema: 'compras',
            hasChildren: true,
          },
        },
        detail('bitacora', [column('id', { pk: true })], [], ['id']),
      ],
      missing: [],
    };

    beforeEach(() => {
      fixture.componentRef.setInput('graph', repetido);
      fixture.detectChanges();
    });

    it('las cajas repetidas dicen de qué esquema son', () => {
      // El orden lo decide la colocación, así que se comparan como conjunto.
      const esquemas = [...dom().querySelectorAll('.node__schema')].map((span) =>
        span.textContent?.trim(),
      );

      expect(esquemas.sort()).toEqual(['compras.', 'ventas.']);
    });

    /** Repetirlo donde no desempata nada solo gasta el ancho de la caja. */
    it('la que no se repite no lo dice', () => {
      const bitacora = nodos().find(
        (node) => node.querySelector('.node__name')?.textContent?.trim() === 'bitacora',
      )!;

      expect(bitacora.querySelector('.node__schema')).toBeNull();
    });
  });

  it('dibuja una caja por tabla y una línea por clave foránea', () => {
    expect(nodos()).toHaveLength(3);
    expect(dom().querySelectorAll('.wire')).toHaveLength(1);
  });

  it('el nivel de detalle cambia las columnas que se ven', () => {
    expect(dom().querySelectorAll('.row').length).toBe(7);

    const claves = [...dom().querySelectorAll<HTMLButtonElement>('.segmented__item')][1];
    claves.click();
    fixture.detectChanges();

    // Solo las que sostienen una relación: cliente.id, factura.id, factura.cliente_id
    // y bitacora.id.
    expect(dom().querySelectorAll('.row').length).toBe(4);

    const plegado = [...dom().querySelectorAll<HTMLButtonElement>('.segmented__item')][2];
    plegado.click();
    fixture.detectChanges();

    expect(dom().querySelectorAll('.row').length).toBe(0);
  });

  /**
   * Lo que hace legible un diagrama grande: marcar una tabla apaga lo que no
   * tiene que ver con ella. Apagado, no escondido.
   */
  it('marcar una tabla resalta sus vecinas y apaga el resto', () => {
    cabecera('factura').click();
    fixture.detectChanges();

    const apagados = nodos().filter((node) => node.classList.contains('is-dim'));

    expect(apagados).toHaveLength(1);
    expect(apagados[0].querySelector('.node__name')?.textContent?.trim()).toBe('bitacora');
  });

  it('volver a marcar la misma tabla apaga el resaltado', () => {
    cabecera('factura').click();
    fixture.detectChanges();
    cabecera('factura').click();
    fixture.detectChanges();

    expect(nodos().filter((node) => node.classList.contains('is-dim'))).toHaveLength(0);
  });

  it('el doble clic sobre la cabecera pide abrir la tabla', () => {
    const abiertas: DatabaseObject[] = [];
    fixture.componentInstance.openTable.subscribe((table) => abiertas.push(table));

    cabecera('cliente').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(abiertas.map((entry) => entry.name)).toEqual(['cliente']);
  });

  it('el interruptor de sugeridas no esconde ninguna clave declarada', () => {
    const toggle = dom().querySelector<HTMLButtonElement>('.toggle')!;

    toggle.click();
    fixture.detectChanges();

    expect(dom().querySelectorAll('.wire')).toHaveLength(1);
    expect(dom().querySelectorAll('.wire.is-suggested')).toHaveLength(0);
  });

  /**
   * Lo que hace útil el diagrama en una base sin claves declaradas, y lo que más
   * fácil sería hacer mal: una suposición no puede parecer un hecho.
   */
  it('dibuja las sugeridas aparte, y el interruptor solo apaga esas', () => {
    fixture.componentRef.setInput('graph', {
      ...grafo,
      suggestions: [
        {
          fromSchema: 'ventas',
          fromTable: 'bitacora',
          column: 'cliente_id',
          toSchema: 'ventas',
          toTable: 'cliente',
          referencedColumn: 'id',
          confidence: 'high' as const,
          reason: '«cliente_id» nombra a «cliente» y el tipo encaja.',
        },
      ],
    } satisfies SchemaGraph);
    fixture.detectChanges();

    expect(dom().querySelectorAll('.wire')).toHaveLength(2);
    expect(dom().querySelectorAll('.wire.is-suggested')).toHaveLength(1);

    // Apagarlas deja las declaradas donde estaban.
    dom().querySelector<HTMLButtonElement>('.toggle')!.click();
    fixture.detectChanges();

    expect(dom().querySelectorAll('.wire')).toHaveLength(1);
    expect(dom().querySelectorAll('.wire.is-suggested')).toHaveLength(0);
  });

  /**
   * Una tabla que ya no está en el catálogo se dice; no se calla dibujando una
   * caja menos.
   */
  it('avisa de las tablas que ya no están', () => {
    fixture.componentRef.setInput('graph', {
      tables: grafo.tables,
      missing: [table('promocion')],
    } satisfies SchemaGraph);
    fixture.detectChanges();

    expect(dom().querySelector('.missing')?.textContent).toContain('1 tabla');
  });

  /**
   * Aceptar una suposición **no la crea**: pide abrir el `ALTER TABLE`. Es lo
   * que impide que algo que Druse dedujo del nombre de una columna acabe en la
   * base sin que nadie lea el SQL.
   */
  it('aceptar una sugerencia pide el ALTER TABLE, y no crea nada', () => {
    const pedidas: string[] = [];
    fixture.componentInstance.acceptSuggestion.subscribe((s) => pedidas.push(s.column));

    fixture.componentRef.setInput('graph', {
      ...grafo,
      suggestions: [
        {
          fromSchema: 'ventas',
          fromTable: 'bitacora',
          column: 'cliente_id',
          toSchema: 'ventas',
          toTable: 'cliente',
          referencedColumn: 'id',
          confidence: 'high' as const,
          reason: '«cliente_id» nombra a «cliente» y el tipo encaja.',
        },
      ],
    } satisfies SchemaGraph);
    fixture.detectChanges();

    // Sin tabla marcada no se ofrece: en un esquema entero serían decenas.
    expect(dom().querySelectorAll('.pending__item')).toHaveLength(0);

    cabecera('bitacora').click();
    fixture.detectChanges();

    const item = dom().querySelector<HTMLElement>('.pending__item')!;
    expect(item.textContent).toContain('nombra a');

    item.querySelector<HTMLButtonElement>('.pending__accept')!.click();

    expect(pedidas).toEqual(['cliente_id']);
  });

  /**
   * El menú de una tabla. Lo que importa aquí es la palabra: **quitar del
   * diagrama** no borra nada, y el lienzo solo lo pide.
   */
  it('el menú de una tabla ofrece quitarla del diagrama sin borrarla', () => {
    const quitadas: string[] = [];
    const datos: string[] = [];

    fixture.componentInstance.removeTable.subscribe((key) => quitadas.push(key));
    fixture.componentInstance.openData.subscribe((table) => datos.push(table.name));

    cabecera('factura').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    fixture.detectChanges();

    const menu = dom().querySelector('.menu')!;
    const items = [...menu.querySelectorAll<HTMLButtonElement>('.menu__item')];

    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Abrir en el diseñador',
      'Ver datos',
      'Traer sus vecinas',
      'Quitar del diagrama',
    ]);

    items[3].click();
    fixture.detectChanges();

    expect(quitadas).toEqual(['ventas.factura']);
    expect(dom().querySelector('.menu')).toBeNull();
    expect(datos).toEqual([]);
  });

  it('el doble clic en una columna abre el diseñador de su tabla', () => {
    const abiertas: string[] = [];
    fixture.componentInstance.openTable.subscribe((table) => abiertas.push(table.name));

    const fila = nodos()
      .find((node) => node.querySelector('.node__name')?.textContent?.trim() === 'factura')!
      .querySelector('.row')!;

    fila.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));

    expect(abiertas).toEqual(['factura']);
  });

  /**
   * Lo que no se puede romper al exportar: un archivo no puede presentar una
   * suposición como una clave foránea.
   */
  it('exporta a texto con las supuestas comentadas, y a SVG con su tamaño', () => {
    const copiado: { text: string; label: string }[] = [];
    const guardado: { name: string; blob: Blob }[] = [];

    fixture.componentInstance.copied.subscribe((payload) => copiado.push(payload));
    fixture.componentInstance.exported.subscribe((file) => guardado.push(file));

    fixture.componentRef.setInput('graph', {
      ...grafo,
      suggestions: [
        {
          fromSchema: 'ventas',
          fromTable: 'bitacora',
          column: 'cliente_id',
          toSchema: 'ventas',
          toTable: 'cliente',
          referencedColumn: 'id',
          confidence: 'high' as const,
          reason: 'nombra a cliente',
        },
      ],
    } satisfies SchemaGraph);
    fixture.detectChanges();

    const abrir = () => {
      dom().querySelector<HTMLButtonElement>('.export .btn')!.click();
      fixture.detectChanges();
    };

    abrir();
    const items = [...dom().querySelectorAll<HTMLButtonElement>('.export__item')];
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Imagen SVG',
      'Imagen PNG',
      'Copiar como Mermaid',
      'Copiar como DBML',
    ]);

    items[2].click();
    fixture.detectChanges();

    expect(copiado[0].label).toBe('Mermaid');
    expect(copiado[0].text).toContain('erDiagram');
    expect(copiado[0].text).toContain('%% supuesta por Druse');

    abrir();
    [...dom().querySelectorAll<HTMLButtonElement>('.export__item')][0].click();

    expect(guardado[0].name).toBe('diagrama.svg');
    expect(guardado[0].blob.type).toContain('image/svg+xml');
  });

  /**
   * Descartar es la respuesta corriente a una suposición —la mayoría no serán
   * ciertas—, y no puede ser irreversible: quien se equivoca se quedaría sin
   * forma de volver a verlas.
   */
  it('una sugerencia se puede descartar, y lo descartado se puede recuperar', () => {
    const descartadas: string[] = [];
    let recuperar = 0;

    fixture.componentInstance.dismissSuggestion.subscribe((s) => descartadas.push(s.column));
    fixture.componentInstance.restoreDismissed.subscribe(() => recuperar++);

    fixture.componentRef.setInput('graph', {
      ...grafo,
      suggestions: [
        {
          fromSchema: 'ventas',
          fromTable: 'bitacora',
          column: 'cliente_id',
          toSchema: 'ventas',
          toTable: 'cliente',
          referencedColumn: 'id',
          confidence: 'high' as const,
          reason: 'nombra a cliente',
        },
      ],
    } satisfies SchemaGraph);
    fixture.detectChanges();

    cabecera('bitacora').click();
    fixture.detectChanges();

    dom().querySelector<HTMLButtonElement>('.pending__dismiss')!.click();

    expect(descartadas).toEqual(['cliente_id']);

    // Con descartes, el lienzo ofrece recuperarlas; sin ellos, no.
    expect(dom().textContent).not.toContain('Recuperar');

    fixture.componentRef.setInput('dismissedCount', 1);
    fixture.detectChanges();

    const recuperarBoton = [...dom().querySelectorAll<HTMLButtonElement>('.toolbar .btn')].find(
      (button) => button.textContent?.includes('Recuperar'),
    )!;

    expect(recuperarBoton.textContent).toContain('1');
    recuperarBoton.click();

    expect(recuperar).toBe(1);
  });

  it('la leyenda está siempre a la vista', () => {
    expect(dom().querySelectorAll('.legend__item')).toHaveLength(3);
  });

  /**
   * El lienzo no resuelve las vecinas: las tablas que apuntan a una no están en
   * el grafo que tiene. Solo pide que se traigan.
   */
  it('traer vecinas pide las de la tabla marcada, y no hace nada sin selección', () => {
    const pedidas: string[] = [];
    fixture.componentInstance.bringNeighbours.subscribe((key) => pedidas.push(key));

    const boton = [...dom().querySelectorAll<HTMLButtonElement>('.toolbar .btn')].find((button) =>
      button.textContent?.includes('Traer vecinas'),
    )!;

    expect(boton.disabled).toBe(true);

    cabecera('factura').click();
    fixture.detectChanges();
    boton.click();

    expect(pedidas).toEqual(['ventas.factura']);
  });
});
