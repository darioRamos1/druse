import { DatabaseObjectKind } from '../models/workspace';

/**
 * Comparación de texto para los buscadores de la aplicación.
 *
 * Los nombres de una base de datos no se buscan como prosa: se teclean a
 * medias, sin acentos y por trozos sueltos —«fac cli» para `factura_cliente`—,
 * y a veces calificados por su esquema. Todo eso vive aquí y no en cada
 * buscador para que el explorador, la paleta y el compositor entiendan lo mismo.
 */

const DIACRITICS = /\p{Diacritic}/gu;

/** Lo que separa una palabra de la siguiente dentro de un identificador. */
const WORD_BREAK = /[^\p{L}\p{N}]/u;

/**
 * Clases que se pueden pedir por prefijo: `t:ventas` son tablas llamadas así.
 *
 * La inicial es la de la palabra en español, que es el idioma de la interfaz.
 */
const KIND_PREFIXES: Readonly<Record<string, DatabaseObjectKind>> = {
  t: 'table',
  v: 'view',
  e: 'schema',
  // `s:` es el que traen quienes vienen de otras herramientas; cuesta poco.
  s: 'schema',
  c: 'column',
  f: 'function',
  p: 'procedure',
  b: 'database',
};

/** Peso de una coincidencia según dónde cae dentro del nombre. */
const EXACT = 4;
const PREFIX = 3;
const WORD = 2;
const ANYWHERE = 1;

/** Un término ya interpretado, listo para medir contra un nombre. */
export interface Search {
  /** Fragmentos que tienen que aparecer todos. */
  readonly parts: readonly string[];
  /** Clases pedidas por prefijo, o `null` si no se pidió ninguna. */
  readonly kinds: ReadonlySet<DatabaseObjectKind> | null;
}

/** Trozo de un nombre, marcado según si lo cubre el término buscado. */
export interface Segment {
  readonly text: string;
  readonly hit: boolean;
}

/**
 * Minúsculas y sin acentos.
 *
 * Nadie teclea `descripción` con tilde cuando busca deprisa, y una columna que
 * sí la lleva no puede quedar fuera por eso.
 */
export function fold(value: string): string {
  return value.normalize('NFD').replace(DIACRITICS, '').toLowerCase();
}

/**
 * Lo escrito, convertido en fragmentos y clases.
 *
 * Devuelve `null` cuando no hay nada que buscar, que es la señal de «enseñarlo
 * todo» para quien llama.
 */
export function parseSearch(raw: string): Search | null {
  const kinds = new Set<DatabaseObjectKind>();
  const parts: string[] = [];

  for (const token of fold(raw).split(/\s+/)) {
    if (!token) {
      continue;
    }

    const colon = token.indexOf(':');
    const kind = colon > 0 ? KIND_PREFIXES[token.slice(0, colon)] : undefined;

    if (kind) {
      kinds.add(kind);
      const rest = token.slice(colon + 1);

      if (rest) {
        parts.push(rest);
      }

      continue;
    }

    parts.push(token);
  }

  if (!parts.length && !kinds.size) {
    return null;
  }

  return { parts, kinds: kinds.size ? kinds : null };
}

/**
 * Cuánto vale la aparición de `part` dentro de `haystack`, ya plegados ambos.
 *
 * Cero significa que no aparece.
 */
function position(haystack: string, part: string): number {
  const at = haystack.indexOf(part);

  if (at < 0) {
    return 0;
  }

  if (at > 0) {
    return WORD_BREAK.test(haystack[at - 1]) ? WORD : ANYWHERE;
  }

  return haystack.length === part.length ? EXACT : PREFIX;
}

/**
 * Relevancia de un nombre frente a los fragmentos buscados. Cero es no coincide.
 *
 * `name` y `qualified` llegan ya plegados. Se miden por separado porque un
 * fragmento con punto —«ventas.cli»— se busca contra el nombre calificado,
 * mientras que el resto va contra el nombre a secas: si todo fuera contra el
 * calificado, teclear «public» sacaría hasta la última tabla del esquema.
 */
export function scoreMatch(name: string, qualified: string, parts: readonly string[]): number {
  if (!parts.length) {
    return ANYWHERE;
  }

  let total = 0;

  for (const part of parts) {
    const hit = position(part.includes('.') ? qualified : name, part);

    if (!hit) {
      return 0;
    }

    total += hit;
  }

  return total;
}

/**
 * El mismo texto plegado, con el índice original de cada carácter.
 *
 * Hace falta para subrayar: plegar cambia las longitudes —`á` se queda en `a`—,
 * así que las posiciones del texto plegado no sirven sobre el original.
 */
function foldWithMap(value: string): { readonly folded: string; readonly map: readonly number[] } {
  let folded = '';
  const map: number[] = [];

  for (let i = 0; i < value.length; i++) {
    const piece = fold(value[i]);

    for (let k = 0; k < piece.length; k++) {
      map.push(i);
    }

    folded += piece;
  }

  return { folded, map };
}

/** El nombre partido en trozos, marcando los que cubre el término. */
export function highlight(label: string, parts: readonly string[]): readonly Segment[] {
  if (!parts.length) {
    return [{ text: label, hit: false }];
  }

  const { folded, map } = foldWithMap(label);
  const hits = new Array<boolean>(label.length).fill(false);

  for (const part of parts) {
    // Se marcan todas las apariciones, no solo la primera: el fragmento puede
    // repetirse dentro del mismo nombre y subrayar media coincidencia despista.
    for (let at = folded.indexOf(part); at >= 0; at = folded.indexOf(part, at + part.length)) {
      for (let k = at; k < at + part.length && k < map.length; k++) {
        hits[map[k]] = true;
      }
    }
  }

  const segments: Segment[] = [];

  for (let i = 0; i < label.length; i++) {
    const last = segments[segments.length - 1];

    if (last && last.hit === hits[i]) {
      segments[segments.length - 1] = { text: last.text + label[i], hit: hits[i] };
      continue;
    }

    segments.push({ text: label[i], hit: hits[i] });
  }

  return segments;
}
