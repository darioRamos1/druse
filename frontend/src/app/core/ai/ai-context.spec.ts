import { describeSchema } from './ai-context';
import { KnownColumn, KnownRelation } from '../../shared/models/workspace';

function column(name: string, dataType: string, extra: Partial<KnownColumn> = {}): KnownColumn {
  return { name, dataType, isNullable: true, isPrimaryKey: false, ...extra };
}

function relation(
  name: string,
  columns: readonly KnownColumn[],
  kind: 'table' | 'view' = 'table',
): KnownRelation {
  return { schema: 'public', name, kind, qualified: `public.${name}`, columns };
}

describe('describeSchema', () => {
  it('no dice nada cuando no hay tablas', () => {
    expect(describeSchema([])).toEqual({ schema: '', tables: [] });
  });

  it('describe cada tabla con sus columnas y tipos', () => {
    const { schema } = describeSchema([
      relation('accionista', [
        column('id', 'integer', { isPrimaryKey: true, isNullable: false }),
        column('nombre', 'text', { isNullable: false }),
        column('ciudad_id', 'integer'),
      ]),
    ]);

    expect(schema).toBe(
      'TABLE public.accionista (\n' +
        '  id integer PRIMARY KEY NOT NULL,\n' +
        '  nombre text NOT NULL,\n' +
        '  ciudad_id integer\n' +
        ');',
    );
  });

  /**
   * Es la razón de ser de esta función: sin tipos, el modelo no sabe si puede
   * sumar una columna o si tiene que convertirla.
   */
  it('incluye el tipo de cada columna', () => {
    const { schema } = describeSchema([
      relation('operacion', [column('importe', 'numeric(12,2)'), column('cuando', 'timestamptz')]),
    ]);

    expect(schema).toContain('importe numeric(12,2)');
    expect(schema).toContain('cuando timestamptz');
  });

  it('distingue una vista de una tabla', () => {
    const { schema } = describeSchema([relation('v_resumen', [column('total', 'numeric')], 'view')]);

    expect(schema).toContain('VIEW public.v_resumen');
  });

  /**
   * Una tabla sin columnas cargadas se nombra igual: el modelo sabe que existe y
   * puede preguntar por ella, que es mejor que fingir que no está.
   */
  it('nombra las tablas de las que aún no se conocen columnas', () => {
    const { schema } = describeSchema([relation('sin_cargar', [])]);

    expect(schema).toBe('TABLE public.sin_cargar;');
  });

  it('pone delante las tablas de las que sí se sabe algo', () => {
    const { tables } = describeSchema([
      relation('vacia', []),
      relation('conocida', [column('id', 'integer')]),
    ]);

    expect(tables[0]).toBe('public.conocida');
  });

  /**
   * Una base de cientos de tablas no cabe en la pregunta, y meterla entera
   * cuesta dinero por tokens y entierra lo que importa.
   */
  it('corta a 40 tablas y dice cuántas quedaron fuera', () => {
    const many = Array.from({ length: 45 }, (_, index) =>
      relation(`t${index}`, [column('id', 'integer')]),
    );

    const { schema, tables } = describeSchema(many);

    expect(tables.length).toBe(40);
    expect(schema).toContain('y 5 tablas más');
  });

  /** Una tabla de ciento veinte columnas se comería el presupuesto entero. */
  it('corta a 60 columnas y dice cuántas quedaron fuera', () => {
    const wide = Array.from({ length: 75 }, (_, index) => column(`c${index}`, 'text'));

    const { schema } = describeSchema([relation('ancha', wide)]);

    expect(schema).toContain('y 15 columnas más');
  });

  /**
   * Lo que no puede pasar nunca: que salga un dato de una fila. Aquí solo hay
   * nombres y tipos, y esta prueba está para que siga siendo así.
   */
  it('no incluye valores, solo estructura', () => {
    const { schema } = describeSchema([
      relation('accionista', [
        column('nombre', 'text', { defaultValue: "'Marta Ibáñez'" }),
        column('saldo', 'numeric', { defaultValue: '1248930.00' }),
      ]),
    ]);

    expect(schema).not.toContain('Marta');
    expect(schema).not.toContain('1248930');
  });
});
