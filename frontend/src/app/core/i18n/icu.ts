/**
 * El subconjunto de ICU MessageFormat que usa Druse.
 *
 * Tres construcciones, y ninguna más:
 *
 * - `{name}`: el parámetro, tal cual.
 * - `{count, plural, one {# fila} other {# filas}}`: con `=0`, `=1`… para casos
 *   exactos, y `#` para el número ya formateado en el idioma.
 * - `{kind, select, table {tabla} view {vista} other {objeto}}`.
 *
 * **Es pequeño a propósito.** Una biblioteca de ICU completa pesa más que todos
 * los catálogos juntos, y lo que Druse necesita cabe aquí. Si algún día hace
 * falta más —fechas dentro del mensaje, ordinales—, se formatean antes y llegan
 * como parámetro.
 */

export type MessageParams = Readonly<Record<string, string | number | null | undefined>>;

/** Un trozo del mensaje ya analizado. */
type Part =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'arg'; readonly name: string }
  | { readonly kind: 'pound' }
  | {
      readonly kind: 'plural';
      readonly name: string;
      readonly options: ReadonlyMap<string, readonly Part[]>;
    }
  | {
      readonly kind: 'select';
      readonly name: string;
      readonly options: ReadonlyMap<string, readonly Part[]>;
    };

/** Un mensaje que no se entiende. Lo usan la guarda de la CI y las pruebas. */
export class MessageSyntaxError extends Error {}

const cache = new Map<string, readonly Part[]>();

/** Analiza un mensaje. Se recuerda: el mismo texto se formatea muchas veces. */
export function parseMessage(message: string): readonly Part[] {
  let parsed = cache.get(message);

  if (!parsed) {
    const parser = new Parser(message);
    parsed = parser.parseParts(false);
    parser.expectEnd();
    cache.set(message, parsed);
  }

  return parsed;
}

/** Los nombres de los parámetros de un mensaje, para comparar traducciones. */
export function messageParams(message: string): string[] {
  const names = new Set<string>();

  const walk = (parts: readonly Part[]) => {
    for (const part of parts) {
      if (part.kind === 'arg' || part.kind === 'plural' || part.kind === 'select') {
        names.add(part.name);
      }

      if (part.kind === 'plural' || part.kind === 'select') {
        for (const option of part.options.values()) {
          walk(option);
        }
      }
    }
  };

  walk(parseMessage(message));

  return [...names].sort();
}

/**
 * Escribe el mensaje con sus parámetros.
 *
 * `locale` decide la regla de plural —el francés trata el 0 como singular— y
 * cómo se escribe `#`. Un parámetro que falta se deja como `{name}` a la vista:
 * es un fallo de quien llama, y esconderlo lo haría más difícil de encontrar.
 */
export function formatMessage(message: string, params: MessageParams, locale: string): string {
  return render(parseMessage(message), params, locale, null);
}

function render(
  parts: readonly Part[],
  params: MessageParams,
  locale: string,
  pound: string | null,
): string {
  let out = '';

  for (const part of parts) {
    switch (part.kind) {
      case 'text':
        out += part.value;
        break;

      case 'arg': {
        const value = params[part.name];
        out +=
          value === undefined || value === null
            ? `{${part.name}}`
            : typeof value === 'number'
              ? new Intl.NumberFormat(locale).format(value)
              : value;
        break;
      }

      case 'pound':
        out += pound ?? '#';
        break;

      case 'plural': {
        const count = Number(params[part.name]);
        const exact = part.options.get(`=${count}`);
        const category = Number.isFinite(count)
          ? new Intl.PluralRules(locale).select(count)
          : 'other';
        const option = exact ?? part.options.get(category) ?? part.options.get('other') ?? [];

        out += render(
          option,
          params,
          locale,
          Number.isFinite(count) ? new Intl.NumberFormat(locale).format(count) : String(count),
        );
        break;
      }

      case 'select': {
        const value = String(params[part.name] ?? '');
        const option = part.options.get(value) ?? part.options.get('other') ?? [];

        out += render(option, params, locale, pound);
        break;
      }
    }
  }

  return out;
}

class Parser {
  private index = 0;

  constructor(private readonly source: string) {}

  /** Lee hasta el final, o hasta la `}` que cierra una opción si `nested`. */
  parseParts(nested: boolean): Part[] {
    const parts: Part[] = [];
    let text = '';

    const flush = () => {
      if (text) {
        parts.push({ kind: 'text', value: text });
        text = '';
      }
    };

    while (this.index < this.source.length) {
      const ch = this.source[this.index];

      if (ch === '}') {
        if (!nested) {
          throw this.error('Sobra una llave de cierre');
        }
        break;
      }

      if (ch === '{') {
        flush();
        parts.push(this.parseArgument());
        continue;
      }

      if (ch === '#' && nested) {
        flush();
        parts.push({ kind: 'pound' });
        this.index++;
        continue;
      }

      // Comilla simple para escribir llaves literales: `'{'`. Dos seguidas son
      // un apóstrofo, que es lo normal en francés.
      if (ch === "'") {
        const next = this.source[this.index + 1];

        if (next === "'") {
          text += "'";
          this.index += 2;
          continue;
        }

        if (next === '{' || next === '}' || next === '#') {
          const close = this.source.indexOf("'", this.index + 1);

          if (close === -1) {
            throw this.error('Una comilla sin cerrar');
          }

          text += this.source.slice(this.index + 1, close);
          this.index = close + 1;
          continue;
        }
      }

      text += ch;
      this.index++;
    }

    flush();

    return parts;
  }

  expectEnd(): void {
    if (this.index < this.source.length) {
      throw this.error('Sobra texto al final');
    }
  }

  private parseArgument(): Part {
    this.index++; // {
    const name = this.readIdentifier();
    this.skipSpaces();

    if (this.source[this.index] === '}') {
      this.index++;
      return { kind: 'arg', name };
    }

    if (this.source[this.index] !== ',') {
      throw this.error(`Se esperaba «,» o «}» detrás de «${name}»`);
    }

    this.index++;
    this.skipSpaces();
    const type = this.readIdentifier();

    if (type !== 'plural' && type !== 'select') {
      throw this.error(`Tipo desconocido «${type}»: solo se admiten plural y select`);
    }

    this.skipSpaces();

    if (this.source[this.index] !== ',') {
      throw this.error(`Se esperaba «,» detrás de «${type}»`);
    }

    this.index++;
    const options = new Map<string, Part[]>();

    for (;;) {
      this.skipSpaces();

      if (this.source[this.index] === '}') {
        this.index++;
        break;
      }

      const selector = this.readSelector();
      this.skipSpaces();

      if (this.source[this.index] !== '{') {
        throw this.error(`Se esperaba «{» para la opción «${selector}»`);
      }

      this.index++;
      options.set(selector, this.parseParts(true));

      if (this.source[this.index] !== '}') {
        throw this.error(`La opción «${selector}» no se cierra`);
      }

      this.index++;
    }

    if (!options.has('other')) {
      throw this.error(`«${name}» necesita la opción «other»`);
    }

    return { kind: type, name, options };
  }

  private readIdentifier(): string {
    this.skipSpaces();
    const match = /^[A-Za-z_][\w]*/.exec(this.source.slice(this.index));

    if (!match) {
      throw this.error('Se esperaba un nombre');
    }

    this.index += match[0].length;
    return match[0];
  }

  private readSelector(): string {
    const match = /^=?[\w-]+/.exec(this.source.slice(this.index));

    if (!match) {
      throw this.error('Se esperaba una opción');
    }

    this.index += match[0].length;
    return match[0];
  }

  private skipSpaces(): void {
    while (/\s/.test(this.source[this.index] ?? '')) {
      this.index++;
    }
  }

  private error(message: string): MessageSyntaxError {
    return new MessageSyntaxError(`${message} (posición ${this.index}): ${this.source}`);
  }
}

/**
 * El pseudoidioma de desarrollo: «Formatear» → «[Ƒöŕɱåţéåŕ ~~~~]».
 *
 * Alarga el texto un 40 % —más de lo que alargan el francés o el portugués— y
 * marca dónde empieza y acaba cada mensaje traducido. Lo que salga sin
 * corchetes en pantalla es texto que no pasó por el catálogo.
 */
export function pseudolocalize(text: string): string {
  const accents: Record<string, string> = {
    a: 'å',
    b: 'ƀ',
    c: 'ç',
    d: 'ð',
    e: 'é',
    f: 'ƒ',
    g: 'ĝ',
    h: 'ĥ',
    i: 'î',
    j: 'ĵ',
    k: 'ķ',
    l: 'ļ',
    m: 'ɱ',
    n: 'ñ',
    o: 'ö',
    p: 'þ',
    r: 'ŕ',
    s: 'š',
    t: 'ţ',
    u: 'û',
    w: 'ŵ',
    y: 'ý',
    z: 'ž',
    A: 'Å',
    C: 'Ç',
    E: 'É',
    F: 'Ƒ',
    I: 'Î',
    O: 'Ö',
    S: 'Š',
    U: 'Û',
  };
  const body = [...text].map((ch) => accents[ch] ?? ch).join('');
  const padding = '~'.repeat(Math.max(1, Math.round(text.length * 0.4)));

  return `[${body} ${padding}]`;
}
