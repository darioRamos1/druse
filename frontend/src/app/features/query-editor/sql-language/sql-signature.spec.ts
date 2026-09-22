import { DatabaseEngine } from '../../../shared/models/workspace';
import { callAt, registerSqlSignatureHelp } from './sql-signature';

describe('callAt', () => {
  it('encuentra la función abierta y el argumento en que se está', () => {
    expect(callAt('SELECT COALESCE(a, ')).toEqual({ name: 'COALESCE', argument: 1 });
    expect(callAt('SELECT COALESCE(')).toEqual({ name: 'COALESCE', argument: 0 });
  });

  it('una llamada ya cerrada no cuenta', () => {
    expect(callAt('SELECT COALESCE(a, b) FROM t WHERE ')).toBeNull();
  });

  it('las comas de una llamada interior no cambian el argumento de fuera', () => {
    expect(callAt('SELECT ROUND(COALESCE(a, b), ')).toEqual({ name: 'ROUND', argument: 1 });
  });

  it('dentro de una llamada interior, manda la interior', () => {
    expect(callAt('SELECT ROUND(COALESCE(a, ')).toEqual({ name: 'COALESCE', argument: 1 });
  });

  it('las comas dentro de una cadena no cuentan', () => {
    expect(callAt("SELECT REPLACE(nombre, ',', ")).toEqual({ name: 'REPLACE', argument: 2 });
  });

  it('dentro de una cadena sin cerrar no hay nada que ayudar', () => {
    expect(callAt("SELECT REPLACE(nombre, 'a,")).toBeNull();
  });

  it('un paréntesis en un comentario no abre nada', () => {
    expect(callAt('SELECT -- ROUND(\n  1')).toBeNull();
  });

  it('un paréntesis sin nombre delante no es una llamada', () => {
    expect(callAt('SELECT (a, ')).toBeNull();
  });

  it('lo que quedó abierto en la instrucción anterior no cuenta', () => {
    expect(callAt('SELECT ROUND(a;\nSELECT ')).toBeNull();
  });
});

/** Monaco mínimo: lo que el proveedor de la ayuda de parámetros usa. */
function signatureAt(sql: string, engine: DatabaseEngine = 'postgresql') {
  let captured: any = null;
  const monaco = {
    languages: {
      registerSignatureHelpProvider: (_language: string, provider: any) => {
        captured = provider;
        return { dispose: () => undefined };
      },
    },
  };

  registerSqlSignatureHelp(monaco as never, () => ({ engine }));

  const model = { getValue: () => sql, getOffsetAt: () => sql.length };

  return captured.provideSignatureHelp(model, { lineNumber: 1, column: sql.length + 1 })?.value;
}

describe('ayuda de parámetros', () => {
  it('muestra la firma y resalta el argumento actual', () => {
    const help = signatureAt('SELECT ROUND(precio, ');

    expect(help.signatures[0].label).toBe('ROUND(número, decimales)');
    expect(help.activeParameter).toBe(1);
  });

  it('resalta por posición, aunque el nombre del parámetro se repita', () => {
    const help = signatureAt('SELECT CONCAT(a, ');
    const [primero, segundo] = help.signatures[0].parameters.map((param: any) => param.label);

    expect(help.signatures[0].label.slice(...primero)).toBe('texto');
    expect(segundo[0]).toBeGreaterThan(primero[0]);
  });

  it('en una función que repite su último parámetro, se queda en él', () => {
    const help = signatureAt('SELECT COALESCE(a, b, c, ');

    expect(help.activeParameter).toBe(1);
  });

  it('usa la firma del motor: DATEDIFF va al revés en MySQL', () => {
    const sqlServer = signatureAt('SELECT DATEDIFF(', 'sqlserver');
    const mysql = signatureAt('SELECT DATEDIFF(', 'mysql');

    expect(sqlServer.signatures[0].label).toBe('DATEDIFF(parte, inicio, fin)');
    expect(mysql.signatures[0].label).toBe('DATEDIFF(fin, inicio)');
  });

  it('calla ante una función que no conoce o que el motor no tiene', () => {
    expect(signatureAt('SELECT mi_funcion(')).toBeUndefined();
    expect(signatureAt('SELECT NVL(', 'postgresql')).toBeUndefined();
  });
});
