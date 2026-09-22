import { SchemaIndex } from '../../../shared/models/workspace';
import { closest, findProblems } from './sql-diagnostics';

function col(name: string, dataType = 'int') {
  return { name, dataType, isPrimaryKey: false, isNullable: false };
}

/** Un solo esquema cargado y con columnas: el caso en que sí se puede afirmar. */
const cargado: SchemaIndex = {
  schemas: ['tpublico'],
  relations: [
    {
      schema: 'tpublico',
      name: 'usuarios',
      kind: 'table',
      qualified: 'tpublico.usuarios',
      columns: [col('id'), col('nombre', 'varchar(200)')],
    },
    {
      schema: 'tpublico',
      name: 'facturas',
      kind: 'table',
      qualified: 'tpublico.facturas',
      // Sin columnas: se sabe que la tabla existe, no lo que tiene dentro.
      columns: [],
    },
  ],
};

const mensajes = (sql: string, index: SchemaIndex = cargado) =>
  findProblems(sql, index).map((problem) => problem.message);

describe('avisos del editor', () => {
  it('avisa de una tabla que no existe en el esquema cargado', () => {
    expect(mensajes('SELECT * FROM tpublico.usuarioss')).toEqual([
      'No existe tpublico.usuarioss en el esquema tpublico. ¿Quisiste decir usuarios?',
    ]);
  });

  it('señala exactamente el nombre, no la línea entera', () => {
    const sql = 'SELECT * FROM tpublico.usuarioss';
    const [problema] = findProblems(sql, cargado);

    expect(sql.slice(problema.start, problema.end)).toBe('tpublico.usuarioss');
  });

  it('no avisa de lo que sí existe', () => {
    expect(mensajes('SELECT * FROM tpublico.usuarios u WHERE u.nombre = 1')).toEqual([]);
  });

  it('avisa de una columna que la tabla no tiene', () => {
    expect(mensajes('SELECT * FROM tpublico.usuarios u WHERE u.nombres = 1')).toEqual([
      'tpublico.usuarios no tiene la columna nombres. ¿Quisiste decir nombre?',
    ]);
  });

  // --- Lo que NO debe avisar ------------------------------------------------
  //
  // Un aviso falso sobre SQL correcto enseña a ignorar los avisos, y a partir de
  // ahí ya no sirven para nada. Estas son las situaciones donde el editor no
  // sabe lo suficiente y tiene que callarse.

  it('calla si el catálogo aún no se ha cargado', () => {
    const vacio: SchemaIndex = { schemas: [], relations: [] };

    expect(mensajes('SELECT * FROM lo_que_sea', vacio)).toEqual([]);
  });

  it('calla sobre un esquema que no se ha traído', () => {
    // `otro` existe en el servidor, pero aquí no se ha cargado: lo que falta es
    // información nuestra, no la tabla.
    expect(mensajes('SELECT * FROM otro.pedidos')).toEqual([]);
  });

  it('calla sobre las columnas de una tabla sin columnas cargadas', () => {
    expect(mensajes('SELECT * FROM tpublico.facturas f WHERE f.loquesea = 1')).toEqual([]);
  });

  it('no confunde una CTE con una tabla', () => {
    const sql = `
      WITH ventas AS (SELECT 1 AS total)
      SELECT * FROM ventas
    `;

    expect(mensajes(sql)).toEqual([]);
  });

  it('no toma el esquema de un nombre calificado por un alias', () => {
    // `tpublico.usuarios` no es «la columna usuarios del alias tpublico».
    expect(mensajes('SELECT tpublico.usuarios.nombre FROM tpublico.usuarios')).toEqual([]);
  });

  it('calla cuando hay varios esquemas y la tabla va sin calificar', () => {
    const dos: SchemaIndex = {
      schemas: ['dbo', 'tpublico'],
      relations: [
        ...cargado.relations,
        {
          schema: 'dbo',
          name: 'auditoria',
          kind: 'table',
          qualified: 'dbo.auditoria',
          columns: [],
        },
      ],
    };

    // Podría estar en un esquema que todavía no se ha traído.
    expect(mensajes('SELECT * FROM pedidos', dos)).toEqual([]);
  });

  // --- ¿Quisiste decir…? ------------------------------------------------------

  it('propone el arreglo con el esquema tal como se escribió', () => {
    const [problema] = findProblems('SELECT * FROM tpublico.usuarioss', cargado);

    expect(problema.fix).toBe('tpublico.usuarios');
  });

  it('propone la columna parecida como arreglo', () => {
    const [problema] = findProblems(
      'SELECT * FROM tpublico.usuarios u WHERE u.nombres = 1',
      cargado,
    );

    expect(problema.fix).toBe('nombre');
  });

  it('no propone nada si ningún nombre se parece', () => {
    const [problema] = findProblems('SELECT * FROM tpublico.inventario', cargado);

    expect(problema.message).toBe('No existe tpublico.inventario en el esquema tpublico.');
    expect(problema.fix).toBeUndefined();
  });

  it('no ofrece arreglo sobre un nombre entre comillas', () => {
    const [problema] = findProblems('SELECT * FROM "usuarioss"', cargado);

    // El aviso sí; reescribirlo sin comillas podría cambiar a qué tabla apunta.
    expect(problema?.fix).toBeUndefined();
  });

  describe('closest', () => {
    it('cuenta dos letras cambiadas de sitio como un solo error', () => {
      expect(closest('usaurios', ['usuarios', 'facturas'])).toBe('usuarios');
    });

    it('no confunde nombres cortos distintos', () => {
      expect(closest('id', ['nombre', 'correo'])).toBeNull();
    });

    it('no propone el mismo nombre', () => {
      expect(closest('Usuarios', ['usuarios'])).toBeNull();
    });
  });
});
