import { MessageSyntaxError, formatMessage, messageParams, pseudolocalize } from './icu';

describe('mensajes ICU', () => {
  it('interpola parámetros', () => {
    expect(formatMessage('Hola, {name}', { name: 'Ana' }, 'es')).toBe('Hola, Ana');
  });

  it('formatea los números según el idioma', () => {
    expect(formatMessage('{n} filas', { n: 12345 }, 'es')).toBe('12.345 filas');
    expect(formatMessage('{n} rows', { n: 12345 }, 'en')).toBe('12,345 rows');
  });

  it('deja a la vista un parámetro que falta, para que se note', () => {
    expect(formatMessage('Hola, {name}', {}, 'es')).toBe('Hola, {name}');
  });

  describe('plural', () => {
    const filas = '{count, plural, =0 {Ninguna fila} one {# fila} other {# filas}}';

    it('elige la forma según la cantidad', () => {
      expect(formatMessage(filas, { count: 0 }, 'es')).toBe('Ninguna fila');
      expect(formatMessage(filas, { count: 1 }, 'es')).toBe('1 fila');
      // En español, los números de cuatro cifras no se agrupan: es la norma.
      expect(formatMessage(filas, { count: 2500 }, 'es')).toBe('2500 filas');
      expect(formatMessage(filas, { count: 12500 }, 'es')).toBe('12.500 filas');
    });

    it('sigue las reglas del idioma: el francés trata el 0 como singular', () => {
      const lignes = '{count, plural, one {# ligne} other {# lignes}}';

      expect(formatMessage(lignes, { count: 0 }, 'fr')).toBe('0 ligne');
      expect(formatMessage(lignes, { count: 0 }, 'en')).toBe('0 lignes');
    });
  });

  it('select elige por valor, con other de respaldo', () => {
    const tipo = '{kind, select, table {tabla} view {vista} other {objeto}}';

    expect(formatMessage(tipo, { kind: 'view' }, 'es')).toBe('vista');
    expect(formatMessage(tipo, { kind: 'raro' }, 'es')).toBe('objeto');
  });

  it('admite plural dentro de select', () => {
    const msg =
      '{kind, select, table {{n, plural, one {# tabla} other {# tablas}}} other {{n} objetos}}';

    expect(formatMessage(msg, { kind: 'table', n: 3 }, 'es')).toBe('3 tablas');
  });

  it('las comillas escriben llaves literales y dos seguidas son un apóstrofo', () => {
    expect(formatMessage("Usa '{'x'}' así", {}, 'es')).toBe('Usa {x} así');
    expect(formatMessage("L''éditeur", {}, 'fr')).toBe("L'éditeur");
  });

  it('rechaza lo que no es ICU válido, con un motivo', () => {
    expect(() => formatMessage('Hola {name', {}, 'es')).toThrow(MessageSyntaxError);
    expect(() => formatMessage('{n, number}', {}, 'es')).toThrow(/solo se admiten plural y select/);
    expect(() => formatMessage('{n, plural, one {x}}', {}, 'es')).toThrow(/other/);
    expect(() => formatMessage('sobra }', {}, 'es')).toThrow(/llave de cierre/);
  });

  it('enumera los parámetros, también los de dentro de las opciones', () => {
    expect(messageParams('{kind, select, table {{n} en {schema}} other {{name}}}')).toEqual([
      'kind',
      'n',
      'name',
      'schema',
    ]);
  });

  it('el pseudoidioma alarga y marca el texto', () => {
    const pseudo = pseudolocalize('Formatear');

    expect(pseudo.startsWith('[Ƒöŕɱåţéåŕ ')).toBe(true);
    expect(pseudo.endsWith(']')).toBe(true);
    expect(pseudo.length).toBeGreaterThan('Formatear'.length * 1.3);
  });
});
