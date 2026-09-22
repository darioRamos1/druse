import type * as MonacoApi from 'monaco-editor';

import { DatabaseEngine } from '../../../shared/models/workspace';
import { referenceFor, signatureLabel } from './sql-reference';

/** Lo que la ayuda de parámetros necesita saber del editor. */
export interface SignatureContext {
  readonly engine: DatabaseEngine;
}

/** La llamada dentro de la cual está el cursor, y en qué argumento. */
export interface CallAtCursor {
  readonly name: string;
  /** Empieza en 0: el número de comas de este nivel antes del cursor. */
  readonly argument: number;
}

/**
 * Hasta dónde se mira hacia atrás.
 *
 * Una llamada no ocupa páginas; mirar el script entero en cada pulsación, con
 * un archivo de miles de líneas abierto, se notaría al escribir.
 */
const LOOKBEHIND = 4000;

/**
 * Palabras reservadas que van delante de un paréntesis sin ser una llamada:
 * `IN (1, 2)`, `VALUES (a, b)`, `SELECT (a + b)`…
 */
const NOT_CALLS = new Set([
  'SELECT',
  'FROM',
  'WHERE',
  'AND',
  'OR',
  'NOT',
  'IN',
  'EXISTS',
  'VALUES',
  'INTO',
  'ON',
  'AS',
  'JOIN',
  'USING',
  'OVER',
  'THEN',
  'ELSE',
  'WHEN',
  'RETURNING',
  'OUTPUT',
  'SET',
]);

/**
 * Encuentra la función cuyo paréntesis sigue abierto en el cursor.
 *
 * Se recorre el texto hacia delante con una pila de paréntesis, saltando lo que
 * no es código —cadenas, identificadores entre comillas y comentarios—: una coma
 * dentro de `'a, b'` no cambia de argumento, y un `(` en un comentario no abre
 * nada. Un paréntesis que no sigue a un nombre —una subconsulta, `(a + b)`—
 * también se apila, para que sus comas no cuenten en la función de fuera.
 */
export function callAt(textBeforeCursor: string): CallAtCursor | null {
  const text = textBeforeCursor.slice(-LOOKBEHIND);
  const stack: { name: string | null; argument: number }[] = [];
  let i = 0;

  while (i < text.length) {
    const ch = text[i];
    const next = text[i + 1];

    if (ch === '-' && next === '-') {
      const fin = text.indexOf('\n', i);
      i = fin === -1 ? text.length : fin + 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      const fin = text.indexOf('*/', i + 2);
      i = fin === -1 ? text.length : fin + 2;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`' || ch === '[') {
      const cierre = ch === '[' ? ']' : ch;
      const fin = text.indexOf(cierre, i + 1);

      // Una cadena sin cerrar llega hasta el cursor: se está escribiendo dentro
      // de ella, y ahí no hay llamada que ayudar.
      if (fin === -1) {
        return null;
      }

      i = fin + 1;
      continue;
    }

    if (ch === '(') {
      const nombre = /([\p{L}_][\p{L}\p{N}_$]*)\s*$/u.exec(text.slice(0, i))?.[1] ?? null;
      const esLlamada = nombre !== null && !NOT_CALLS.has(nombre.toUpperCase());

      stack.push({ name: esLlamada ? nombre : null, argument: 0 });
    } else if (ch === ')') {
      stack.pop();
    } else if (ch === ',' && stack.length > 0) {
      stack[stack.length - 1].argument += 1;
    } else if (ch === ';') {
      // Otra instrucción: lo que quedara abierto era un error de la anterior.
      stack.length = 0;
    }

    i += 1;
  }

  const actual = stack.at(-1);

  return actual?.name ? { name: actual.name, argument: actual.argument } : null;
}

/**
 * Dónde está cada parámetro dentro de la firma, en posiciones.
 *
 * Por posición y no por nombre: `CONCAT(texto, texto, …)` repite el nombre, y
 * Monaco, buscando por texto, resaltaría siempre el primero.
 */
function parameterRanges(
  name: string,
  params: readonly { readonly name: string }[],
): [number, number][] {
  let cursor = name.length + 1;

  return params.map((param) => {
    const range: [number, number] = [cursor, cursor + param.name.length];
    cursor += param.name.length + 2;

    return range;
  });
}

/**
 * Registra la ayuda de parámetros: la firma de la función que se está
 * escribiendo, con el argumento actual resaltado.
 *
 * Es lo que evita salir a buscar si `DATEDIFF` pedía primero la fecha de inicio
 * o la de fin, que además cambia de un motor a otro.
 */
export function registerSqlSignatureHelp(
  monaco: typeof MonacoApi,
  getContext: () => SignatureContext,
): () => void {
  const provider = monaco.languages.registerSignatureHelpProvider('sql', {
    signatureHelpTriggerCharacters: ['(', ','],
    signatureHelpRetriggerCharacters: [','],

    provideSignatureHelp(model, position) {
      const offset = model.getOffsetAt(position);
      const call = callAt(model.getValue().slice(0, offset));

      if (!call) {
        return null;
      }

      const reference = referenceFor(call.name, getContext().engine);
      const params = reference?.params ?? [];

      if (!reference || reference.kind !== 'function' || params.length === 0) {
        return null;
      }

      // Pasado el último parámetro, una función que los repite sigue en el
      // último; una que no, ya no tiene nada que resaltar.
      const activeParameter = reference.variadic
        ? Math.min(call.argument, params.length - 1)
        : call.argument;

      return {
        value: {
          signatures: [
            {
              label: signatureLabel(reference),
              documentation: { value: reference.summary },
              parameters: parameterRanges(reference.name, params).map((range, index) => ({
                label: range,
                documentation: { value: params[index].doc },
              })),
            },
          ],
          activeSignature: 0,
          activeParameter,
        },
        dispose: () => undefined,
      };
    },
  });

  return () => provider.dispose();
}
