import { split } from './ai-panel';

/**
 * Partir la respuesta en prosa y SQL.
 *
 * Es lo único del panel que puede equivocarse en silencio: un bloque mal
 * detectado deja el SQL como texto corrido —sin el botón de insertarlo, que es
 * para lo que sirve el asistente— o se traga la explicación.
 */
describe('split', () => {
  it('deja el texto suelto como una sola parte', () => {
    expect(split('No hace falta SQL para eso.')).toEqual([
      { kind: 'text', text: 'No hace falta SQL para eso.' },
    ]);
  });

  it('separa la explicación del SQL', () => {
    const parts = split('Agrupando por accionista:\n\n```sql\nSELECT 1\n```\n\nY ya está.');

    expect(parts).toEqual([
      { kind: 'text', text: 'Agrupando por accionista:' },
      { kind: 'sql', text: 'SELECT 1' },
      { kind: 'text', text: 'Y ya está.' },
    ]);
  });

  it('reconoce el bloque sin la etiqueta del lenguaje', () => {
    expect(split('```\nSELECT 1\n```')).toEqual([{ kind: 'sql', text: 'SELECT 1' }]);
  });

  it('admite varios bloques en una respuesta', () => {
    const parts = split('Primero:\n```sql\nSELECT 1\n```\nDespués:\n```sql\nSELECT 2\n```');

    expect(parts.filter((part) => part.kind === 'sql').map((part) => part.text)).toEqual([
      'SELECT 1',
      'SELECT 2',
    ]);
  });

  /**
   * Mientras la respuesta llega, el bloque está abierto y no tiene cierre.
   *
   * Sin esto, el SQL no aparecería hasta la última letra: se vería un hueco
   * durante toda la respuesta y luego el bloque de golpe.
   */
  it('enseña el SQL de un bloque que todavía se está escribiendo', () => {
    const parts = split('Ahí va:\n```sql\nSELECT a.nombre\nFROM accionista a');

    expect(parts).toEqual([
      { kind: 'text', text: 'Ahí va:' },
      { kind: 'sql', text: 'SELECT a.nombre\nFROM accionista a' },
    ]);
  });

  it('no crea partes vacías', () => {
    expect(split('```sql\n\n```')).toEqual([]);
    expect(split('')).toEqual([]);
  });

  it('conserva los saltos dentro del SQL', () => {
    const [part] = split('```sql\nSELECT 1,\n       2\n```');

    expect(part).toEqual({ kind: 'sql', text: 'SELECT 1,\n       2' });
  });
});
