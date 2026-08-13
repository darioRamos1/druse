import { executionErrorLine } from './execution-error';

describe('executionErrorLine', () => {
  it('convierte una posición PostgreSQL en la línea enviada', () => {
    const sql = 'SELECT 1;\nSELECT * FROM';

    expect(executionErrorLine({ message: 'error', position: 20 }, sql)).toBe(2);
  });

  it('usa la línea que reporta SQL Server', () => {
    expect(executionErrorLine({ message: 'error', line: 3 }, 'SELECT 1')).toBe(3);
  });

  it('prefiere la posición cuando el motor informa ambas ubicaciones', () => {
    expect(executionErrorLine({ message: 'error', position: 2, line: 4 }, 'X\nY')).toBe(1);
  });

  it('cuenta caracteres Unicode como el servidor PostgreSQL', () => {
    expect(executionErrorLine({ message: 'error', position: 3 }, '😀\nX')).toBe(2);
  });

  it('no inventa una línea cuando el motor no informa ubicación', () => {
    expect(executionErrorLine({ message: 'error' }, 'SELECT * FROM')).toBeNull();
  });
});
