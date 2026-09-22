import { DatabaseEngine } from '../../../shared/models/workspace';

/** Un parámetro de una función, con lo que espera. */
export interface SqlParameter {
  readonly name: string;
  readonly doc: string;
}

/**
 * Lo que el editor sabe contar de una función o de una palabra reservada.
 *
 * Es la fuente de las tres ayudas que explican el SQL —la descripción del
 * autocompletado, el tooltip y la ayuda de parámetros—, y por eso vive aparte:
 * si cada una llevara su texto, acabarían contando cosas distintas de lo mismo.
 */
export interface SqlReferenceEntry {
  /** Como se escribe, en mayúsculas salvo que el motor lo documente de otra forma. */
  readonly name: string;
  readonly kind: 'function' | 'keyword';
  /** Una frase: qué hace, no cómo está implementado. */
  readonly summary: string;
  /** Solo en funciones. */
  readonly params?: readonly SqlParameter[];
  /** El último parámetro puede repetirse: `COALESCE(a, b, c, …)`. */
  readonly variadic?: boolean;
  readonly example?: string;
  /**
   * En qué motores existe. Sin esto, en todos.
   *
   * **Se declara y no se supone.** Sugerir `LENGTH` en SQL Server, donde se
   * llama `LEN`, es enseñar a escribir un error.
   */
  readonly engines?: readonly DatabaseEngine[];
}

export const INFORMIX: readonly DatabaseEngine[] = ['informix', 'informixsqli'];

export const fn = (
  name: string,
  summary: string,
  params: readonly (readonly [string, string])[],
  extra: Partial<Pick<SqlReferenceEntry, 'variadic' | 'example' | 'engines'>> = {},
): SqlReferenceEntry => ({
  name,
  kind: 'function',
  summary,
  params: params.map(([paramName, doc]) => ({ name: paramName, doc })),
  ...extra,
});

export const kw = (
  name: string,
  summary: string,
  extra: Partial<Pick<SqlReferenceEntry, 'example' | 'engines'>> = {},
): SqlReferenceEntry => ({ name, kind: 'keyword', summary, ...extra });
