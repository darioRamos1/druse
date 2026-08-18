/**
 * Dónde empieza y acaba cada instrucción de un guion.
 *
 * Existe para «Ejecutar actual»: mandar solo la instrucción donde está el cursor
 * en vez de la pestaña entera. Partir por `;` a lo bruto no vale, porque un `;`
 * dentro de un literal —`'O''Donnell; 12'`—, de un identificador citado o de un
 * comentario es un carácter más, y cortar ahí manda al servidor media
 * instrucción.
 *
 * Es el mismo criterio que usa `SqlStatementReader` para leer un respaldo, y por
 * los mismos motivos: los cuatro motores citan distinto —comillas dobles,
 * corchetes, acentos graves— y aquí tampoco se sabe de cuál se trata. La
 * diferencia es lo que se busca: allí las instrucciones para ejecutarlas todas,
 * aquí **dónde está cada una** para poder señalar la del cursor.
 *
 * **No se reconoce el `$cuerpo$ … $cuerpo$` de PostgreSQL.** Un `CREATE
 * FUNCTION` con `;` dentro se partiría por la mitad, igual que en el lector de
 * respaldos. Se declara en vez de disimularse: quien escriba una función tiene
 * «Ejecutar», que manda la pestaña entera, y seleccionar a mano, que tampoco
 * pasa por aquí.
 */

/** Una instrucción encontrada en el texto, con dónde está escrita. */
export interface SqlStatement {
  /** El texto que hay que ejecutar, ya recortado. */
  readonly text: string;

  /**
   * Dónde empieza `text` dentro del documento completo.
   *
   * Es lo que permite que el error del servidor señale la línea de verdad y no
   * la primera del fragmento.
   */
  readonly startOffset: number;
}

/** Por dónde va el escáner. */
const enum Mode {
  Code,
  /** `-- …` hasta el fin de la línea. */
  LineComment,
  /** `/* … *​/`. */
  BlockComment,
  /** Literal `'…'`. */
  Text,
  /** Identificador `"…"`, `[…]` o `` `…` ``. */
  Quoted,
}

/** Un tramo del documento: todo lo que hay entre dos `;` de verdad. */
interface Span {
  /** Primer carácter del tramo, contando desde el `;` anterior. */
  readonly from: number;
  /** Último carácter del contenido, sin incluir el `;` que lo cierra. */
  readonly to: number;
  /** Si hay algo más que espacios y comentarios. */
  readonly hasCode: boolean;
}

/**
 * Parte el texto en tramos consecutivos que lo cubren entero.
 *
 * Cubrirlo entero es lo que permite después situar cualquier cursor: si los
 * tramos fueran solo las instrucciones, un cursor en la línea en blanco de en
 * medio no caería en ninguno.
 */
function spansOf(sql: string): Span[] {
  const spans: Span[] = [];

  let mode: Mode = Mode.Code;
  let closing = '';
  let previous = '';
  let from = 0;
  let hasCode = false;

  /**
   * Un `-` o un `/` que todavía no se sabe si es código.
   *
   * `--` y `/*` abren comentario, pero un `-` suelto es una resta y un `/` una
   * división. Contarlos como código al verlos haría que un tramo con solo un
   * comentario dentro pareciera tener algo que ejecutar, y «Ejecutar actual»
   * mandaría un comentario al servidor.
   */
  let pending = '';

  /** El pendiente resultó ser código: no abrió ningún comentario. */
  const settle = () => {
    if (pending) {
      hasCode = true;
      pending = '';
    }
  };

  for (let index = 0; index < sql.length; index++) {
    const character = sql[index];

    switch (mode) {
      case Mode.LineComment:
        if (character === '\n') {
          mode = Mode.Code;
        }

        break;

      case Mode.BlockComment:
        if (previous === '*' && character === '/') {
          mode = Mode.Code;
          // Se olvida el carácter para que `/*/` no cierre lo que acababa de
          // abrir.
          previous = '';
          continue;
        }

        break;

      case Mode.Text:
        // Una comilla cierra el literal. Si venía otra detrás —`''`, la forma de
        // escribir una comilla dentro— el siguiente carácter vuelve a abrirlo,
        // que es justo lo que hace falta.
        if (character === "'") {
          mode = Mode.Code;
        }

        break;

      case Mode.Quoted:
        if (character === closing) {
          mode = Mode.Code;
        }

        break;

      default:
        switch (character) {
          case "'":
            settle();
            mode = Mode.Text;
            hasCode = true;
            break;

          case '"':
          case '[':
          case '`':
            settle();
            mode = Mode.Quoted;
            closing = character === '[' ? ']' : character;
            hasCode = true;
            break;

          case '-':
            // La segunda de un `--` abre comentario, y entonces la primera nunca
            // fue código. Una sola espera al carácter siguiente para saberlo.
            if (pending === '-') {
              pending = '';
              mode = Mode.LineComment;
            } else {
              settle();
              pending = '-';
            }

            break;

          case '/':
            settle();
            pending = '/';
            break;

          case '*':
            if (pending === '/') {
              pending = '';
              mode = Mode.BlockComment;
            } else {
              settle();
              hasCode = true;
            }

            break;

          case ';':
            settle();
            spans.push({ from, to: index, hasCode });

            from = index + 1;
            hasCode = false;
            previous = '';
            continue;

          default:
            settle();

            if (character.trim().length > 0) {
              hasCode = true;
            }

            break;
        }

        break;
    }

    previous = character;
  }

  settle();

  // Lo que quede sin `;` final también es una instrucción: la última de una
  // pestaña casi nunca lo lleva.
  spans.push({ from, to: sql.length, hasCode });

  return spans;
}

/** Un tramo con sus bordes recortados, o nulo si dentro no había nada. */
function trim(sql: string, span: Span): SqlStatement | null {
  if (!span.hasCode) {
    return null;
  }

  let start = span.from;
  let end = span.to;

  while (start < end && sql[start].trim().length === 0) {
    start++;
  }

  while (end > start && sql[end - 1].trim().length === 0) {
    end--;
  }

  return start < end ? { text: sql.slice(start, end), startOffset: start } : null;
}

/** Todas las instrucciones del texto, en orden. */
export function statementsOf(sql: string): SqlStatement[] {
  return spansOf(sql)
    .map((span) => trim(sql, span))
    .filter((statement): statement is SqlStatement => statement !== null);
}

/**
 * La instrucción donde está el cursor.
 *
 * **Justo detrás del `;` cuenta como dentro de la que acaba de cerrarse.** Es el
 * caso de escribirla, ponerle el punto y coma y pulsar el atajo sin mover el
 * cursor: ejecutar la de abajo ahí sería una sorpresa desagradable.
 *
 * Si el tramo donde cae no tiene nada que ejecutar —una línea en blanco suelta,
 * un comentario entre dos puntos y coma— se busca hacia atrás y, si tampoco hay
 * nada, hacia adelante. Devuelve nulo solo cuando en toda la pestaña no hay
 * ninguna instrucción.
 */
export function statementAt(sql: string, offset: number): SqlStatement | null {
  const spans = spansOf(sql);
  const position = Math.max(0, Math.min(offset, sql.length));

  // El tramo que contiene el cursor, contando el hueco de después del `;` como
  // suyo. Los tramos cubren el texto entero, así que siempre hay uno; el `< 0`
  // es por el texto vacío.
  const index = spans.findIndex((span) => position >= span.from && position <= span.to + 1);
  const current = index < 0 ? spans.length - 1 : index;

  for (let previous = current; previous >= 0; previous--) {
    const statement = trim(sql, spans[previous]);

    if (statement) {
      return statement;
    }
  }

  for (let next = current + 1; next < spans.length; next++) {
    const statement = trim(sql, spans[next]);

    if (statement) {
      return statement;
    }
  }

  return null;
}
