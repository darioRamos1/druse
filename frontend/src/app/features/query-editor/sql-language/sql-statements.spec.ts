import { statementAt, statementsOf } from './sql-statements';

/** El texto de la instrucción bajo el cursor, o nulo. */
const enCursor = (sql: string, offset: number) => statementAt(sql, offset)?.text ?? null;

/** Dónde cae el cursor cuando se marca con `|` en el propio caso. */
function marcado(sql: string): { texto: string; cursor: number } {
  const cursor = sql.indexOf('|');

  return { texto: sql.replace('|', ''), cursor };
}

const conCursor = (sql: string) => {
  const { texto, cursor } = marcado(sql);

  return enCursor(texto, cursor);
};

describe('instrucciones de un guion', () => {
  it('parte por los puntos y coma', () => {
    expect(statementsOf('SELECT 1; SELECT 2; SELECT 3').map((s) => s.text)).toEqual([
      'SELECT 1',
      'SELECT 2',
      'SELECT 3',
    ]);
  });

  it('no parte por un punto y coma dentro de un literal', () => {
    const sql = "INSERT INTO clientes (nombre) VALUES ('O''Donnell; 12')";

    expect(statementsOf(sql).map((s) => s.text)).toEqual([sql]);
  });

  it('no parte por un punto y coma dentro de un comentario', () => {
    expect(statementsOf('SELECT 1 -- ojo; aquí no\nFROM dual').map((s) => s.text)).toEqual([
      'SELECT 1 -- ojo; aquí no\nFROM dual',
    ]);

    expect(statementsOf('SELECT /* ni; aquí */ 1').map((s) => s.text)).toEqual([
      'SELECT /* ni; aquí */ 1',
    ]);
  });

  it('no parte dentro de un identificador citado, lo cite como lo cite el motor', () => {
    // Los cuatro motores citan distinto y aquí no se sabe cuál es.
    expect(statementsOf('SELECT "a;b" FROM t').map((s) => s.text)).toEqual(['SELECT "a;b" FROM t']);
    expect(statementsOf('SELECT [a;b] FROM t').map((s) => s.text)).toEqual(['SELECT [a;b] FROM t']);
    expect(statementsOf('SELECT `a;b` FROM t').map((s) => s.text)).toEqual(['SELECT `a;b` FROM t']);
  });

  it('un tramo con solo comentarios no es una instrucción', () => {
    expect(statementsOf('-- nada que ejecutar\n/* tampoco */').map((s) => s.text)).toEqual([]);
  });

  it('una resta y una división no son comentarios', () => {
    expect(statementsOf('SELECT 5 - 2, 6 / 3').map((s) => s.text)).toEqual(['SELECT 5 - 2, 6 / 3']);
  });

  it('dice dónde empieza cada una, para que el error señale su línea', () => {
    const sql = 'SELECT 1;\n\nSELECT 2';
    const [primera, segunda] = statementsOf(sql);

    expect(primera.startOffset).toBe(0);
    expect(segunda.startOffset).toBe(sql.indexOf('SELECT 2'));
  });
});

describe('la instrucción del cursor', () => {
  const guion = 'SELECT 1;\nSELECT 2;\nSELECT 3';

  it('es aquella dentro de la que está', () => {
    expect(conCursor('SELECT 1;\nSEL|ECT 2;\nSELECT 3')).toBe('SELECT 2');
  });

  it('lo es también con el cursor pegado a su primer carácter', () => {
    expect(conCursor('SELECT 1;\n|SELECT 2;\nSELECT 3')).toBe('SELECT 2');
  });

  it('con el cursor justo detrás del punto y coma, es la que se acaba de escribir', () => {
    // Es el caso de escribir la instrucción, cerrarla y pulsar el atajo sin
    // mover el cursor: lo que se quiere ejecutar es lo de arriba.
    expect(conCursor('SELECT 1;|\nSELECT 2')).toBe('SELECT 1');
  });

  it('en la línea en blanco de en medio, es la de abajo', () => {
    // El hueco pertenece a lo que viene: solo el sitio pegado al `;` se cuenta
    // como parte de la instrucción que se acaba de cerrar.
    expect(conCursor('SELECT 1;\n|\nSELECT 2')).toBe('SELECT 2');
  });

  it('el comentario que precede a una instrucción va con ella', () => {
    expect(conCursor('SELECT 1;\n-- lo que viene|\nSELECT 2')).toBe('-- lo que viene\nSELECT 2');
  });

  it('al final del todo, es la última', () => {
    expect(enCursor(guion, guion.length)).toBe('SELECT 3');
  });

  it('antes de la primera, mira hacia adelante', () => {
    expect(conCursor('|\n\nSELECT 1;\nSELECT 2')).toBe('SELECT 1');
  });

  it('salta los tramos que no traen nada que ejecutar', () => {
    expect(conCursor('SELECT 1;\n-- un aparte|\n;\nSELECT 2')).toBe('SELECT 1');
  });

  it('sin nada que ejecutar, no devuelve nada', () => {
    expect(enCursor('', 0)).toBeNull();
    expect(enCursor('   \n\n', 3)).toBeNull();
    expect(enCursor('-- solo un comentario', 5)).toBeNull();
  });

  it('aguanta un desplazamiento fuera del texto', () => {
    expect(enCursor(guion, 9999)).toBe('SELECT 3');
    expect(enCursor(guion, -5)).toBe('SELECT 1');
  });
});
