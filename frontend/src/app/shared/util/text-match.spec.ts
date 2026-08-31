import { fold, highlight, parseSearch, scoreMatch } from './text-match';

describe('text-match', () => {
  it('pliega acentos y mayúsculas para que «descripcion» encuentre «Descripción»', () => {
    expect(fold('Descripción')).toBe('descripcion');
    expect(scoreMatch(fold('Descripción'), fold('public.Descripción'), ['descripcion'])).toBe(4);
  });

  it('exige todos los fragmentos, en cualquier orden', () => {
    const parts = parseSearch('fac cli')?.parts ?? [];

    expect(scoreMatch(fold('factura_cliente'), '', parts)).toBeGreaterThan(0);
    expect(scoreMatch(fold('factura_proveedor'), '', parts)).toBe(0);
  });

  it('vale más el prefijo que la coincidencia a mitad de nombre', () => {
    const exacto = scoreMatch('clientes', '', ['clientes']);
    const prefijo = scoreMatch('clientes_baja', '', ['cli']);
    const palabra = scoreMatch('factura_clientes', '', ['cli']);
    const suelto = scoreMatch('reclinado', '', ['cli']);

    expect(exacto).toBeGreaterThan(prefijo);
    expect(prefijo).toBeGreaterThan(palabra);
    expect(palabra).toBeGreaterThan(suelto);
    expect(suelto).toBeGreaterThan(0);
  });

  /**
   * Sin esta regla, teclear el nombre de un esquema sacaría todas sus tablas.
   */
  it('solo mide contra el nombre calificado el fragmento que lleva punto', () => {
    expect(scoreMatch('clientes', 'ventas.clientes', ['ventas'])).toBe(0);
    expect(scoreMatch('clientes', 'ventas.clientes', ['ventas.cli'])).toBeGreaterThan(0);
  });

  it('entiende los prefijos de clase', () => {
    const search = parseSearch('t:ventas');

    expect(search?.kinds && [...search.kinds]).toEqual(['table']);
    expect(search?.parts).toEqual(['ventas']);
  });

  it('un prefijo sin texto pide la clase entera', () => {
    const search = parseSearch('v:');

    expect(search?.kinds && [...search.kinds]).toEqual(['view']);
    expect(search?.parts).toEqual([]);
    expect(scoreMatch('lo_que_sea', '', [])).toBeGreaterThan(0);
  });

  it('un campo vacío no es un término', () => {
    expect(parseSearch('   ')).toBeNull();
  });

  it('subraya el trozo coincidente sobre el nombre original, con acento incluido', () => {
    const segments = highlight('Año_Fiscal', ['ano']);

    expect(segments.map((segment) => segment.text).join('')).toBe('Año_Fiscal');
    expect(segments.filter((segment) => segment.hit).map((segment) => segment.text)).toEqual([
      'Año',
    ]);
  });

  it('subraya todas las apariciones del fragmento', () => {
    const segments = highlight('cli_recibo_cli', ['cli']);

    expect(segments.filter((segment) => segment.hit)).toHaveLength(2);
  });
});
