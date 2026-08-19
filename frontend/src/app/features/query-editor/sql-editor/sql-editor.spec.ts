import { executionErrorPlace } from './execution-error';

describe('executionErrorPlace', () => {
  it('convierte la posición del motor en línea y columna', () => {
    const sql = 'SELECT 1\nFROM tabla_x';

    // El carácter 20 cae en la segunda línea, sexta columna.
    expect(executionErrorPlace({ message: 'error', position: 20 }, sql)).toEqual({
      line: 2,
      column: 11,
    });
  });

  it('señala la palabra culpable, no la línea entera', () => {
    // Es el caso real de PostgreSQL: «syntax error at or near "FROM"» con la
    // posición del propio FROM.
    const sql = 'SELECT\n  uno,\n  FROM tabla_x\n';

    expect(executionErrorPlace({ message: 'syntax error', position: 17 }, sql)).toEqual({
      line: 3,
      column: 3,
    });
  });

  it('la primera posición es la primera columna', () => {
    expect(executionErrorPlace({ message: 'error', position: 1 }, 'SELECT')).toEqual({
      line: 1,
      column: 1,
    });
  });

  it('usa la línea cuando el motor solo da la línea', () => {
    // SQL Server y MySQL: sin columna, y por eso se subraya la línea entera en
    // lugar de inventarse un sitio.
    expect(executionErrorPlace({ message: 'error', line: 3 }, 'SELECT 1')).toEqual({
      line: 3,
      column: null,
    });
  });

  it('la posición manda sobre la línea', () => {
    expect(executionErrorPlace({ message: 'error', position: 2, line: 4 }, 'X\nY')).toEqual({
      line: 1,
      column: 2,
    });
  });

  it('cuenta por caracteres y no por unidades UTF-16', () => {
    // Un emoji ocupa dos unidades: contándolas, el error caería una línea antes.
    expect(executionErrorPlace({ message: 'error', position: 3 }, '😀\nX')).toEqual({
      line: 2,
      column: 1,
    });
  });

  it('sin ubicación, no se señala nada', () => {
    expect(executionErrorPlace({ message: 'error' }, 'SELECT * FROM')).toBeNull();
  });
});
