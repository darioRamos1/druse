import { SchemaGraph, SuggestedRelation, TableDetail } from '../../shared/models/workspace';
import { translate } from '../../core/i18n/active';

/**
 * El diagrama como texto.
 *
 * Es la salida que se versiona en git y la que GitHub dibuja solo, así que vale
 * tanto como la imagen: un `README` con el esquema al día es más útil que un PNG
 * que nadie vuelve a generar.
 *
 * **Las relaciones supuestas viajan comentadas.** Un diagrama exportado que
 * presenta suposiciones como claves foráneas es peor que no exportarlo: quien
 * lea el archivo no tiene forma de saber cuáles comprueba el motor.
 */

/** Qué se enseña de cada relación en el texto. */
export interface ExportOptions {
  /** Las supuestas entran comentadas; sin esto, no entran. */
  readonly includeSuggested: boolean;
}

/**
 * Deja un nombre que Mermaid y DBML acepten.
 *
 * Un identificador con espacios o acentos —que los motores admiten entre
 * comillas— rompe los dos formatos, y el archivo se queda sin dibujar sin decir
 * por qué.
 */
function safeName(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N}_]/gu, '_');

  return /^[\p{L}_]/u.test(clean) ? clean : `t_${clean}`;
}

/** El tipo, sin lo que Mermaid no sabe leer: paréntesis, comas y espacios. */
function safeType(dataType: string): string {
  return dataType.replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_]/gu, '') || 'desconocido';
}

/** Columnas que forman una clave foránea de la tabla. */
function foreignColumns(detail: TableDetail): Set<string> {
  const columns = new Set<string>();

  for (const key of detail.structure.foreignKeys) {
    for (const column of key.columns) {
      columns.add(column.toLowerCase());
    }
  }

  return columns;
}

/**
 * El diagrama en Mermaid, que GitHub dibuja sin instalar nada.
 *
 * La cardinalidad sale del catálogo igual que en el lienzo: el lado hijo es
 * «muchos» y es opcional cuando su columna admite nulos.
 */
export function toMermaid(graph: SchemaGraph, options: ExportOptions): string {
  const lines = ['erDiagram'];

  for (const detail of graph.tables) {
    const primary = new Set(
      (detail.structure.primaryKey?.columns ?? []).map((column) => column.toLowerCase()),
    );
    const foreign = foreignColumns(detail);

    lines.push(`    ${safeName(detail.table.name)} {`);

    for (const column of detail.columns) {
      const marks: string[] = [];

      if (primary.has(column.name.toLowerCase())) {
        marks.push('PK');
      }
      if (foreign.has(column.name.toLowerCase())) {
        marks.push('FK');
      }

      lines.push(
        `        ${safeType(column.dataType)} ${safeName(column.name)}${marks.length > 0 ? ` ${marks.join(',')}` : ''}`,
      );
    }

    lines.push('    }');
  }

  for (const detail of graph.tables) {
    const nullable = new Set(
      detail.columns
        .filter((column) => column.isNullable)
        .map((column) => column.name.toLowerCase()),
    );

    for (const key of detail.structure.foreignKeys) {
      const optional = key.columns.some((column) => nullable.has(column.toLowerCase()));

      lines.push(
        `    ${safeName(key.referencedTable)} ||--${optional ? 'o' : '|'}{ ` +
          `${safeName(detail.table.name)} : "${key.columns.join(', ')}"`,
      );
    }
  }

  if (options.includeSuggested) {
    for (const suggestion of graph.suggestions ?? []) {
      // Comentada, siempre: nadie comprueba esta relación.
      lines.push(
        `    %% ${translate('diagram.export.assumed')}: ${safeName(suggestion.toTable)} ||--o{ ` +
          `${safeName(suggestion.fromTable)} : "${suggestion.column}"`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

/** El diagrama en DBML, el formato de dbdiagram.io. */
export function toDbml(graph: SchemaGraph, options: ExportOptions): string {
  const lines: string[] = [];

  for (const detail of graph.tables) {
    const primary = new Set(
      (detail.structure.primaryKey?.columns ?? []).map((column) => column.toLowerCase()),
    );

    lines.push(`Table ${safeName(detail.table.name)} {`);

    for (const column of detail.columns) {
      const notes: string[] = [];

      if (primary.has(column.name.toLowerCase())) {
        notes.push('pk');
      }
      if (!column.isNullable) {
        notes.push('not null');
      }

      lines.push(
        `  ${safeName(column.name)} ${safeType(column.dataType)}` +
          `${notes.length > 0 ? ` [${notes.join(', ')}]` : ''}`,
      );
    }

    lines.push('}', '');
  }

  for (const detail of graph.tables) {
    for (const key of detail.structure.foreignKeys) {
      const own = key.columns[0] ?? '';
      const other = key.referencedColumns[0] ?? 'id';

      lines.push(
        `Ref: ${safeName(detail.table.name)}.${safeName(own)} > ` +
          `${safeName(key.referencedTable)}.${safeName(other)}`,
      );
    }
  }

  if (options.includeSuggested) {
    for (const suggestion of graph.suggestions ?? []) {
      lines.push(
        `// ${translate('diagram.export.assumed')}: ${safeName(suggestion.fromTable)}.` +
          `${safeName(suggestion.column)} > ${safeName(suggestion.toTable)}.` +
          `${safeName(suggestion.referencedColumn)}`,
      );
    }
  }

  return `${lines.join('\n')}\n`;
}

/**
 * El lienzo como SVG independiente.
 *
 * Los estilos del componente no viajan con el nodo —viven en su hoja—, así que
 * hay que volcarlos al propio archivo: sin esto el SVG sale sin colores y nadie
 * entiende por qué.
 */
export function toStandaloneSvg(source: SVGSVGElement, palette: ExportPalette): string {
  const copy = source.cloneNode(true) as SVGSVGElement;

  copy.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  copy.setAttribute('style', `background: ${palette.background}`);

  return new XMLSerializer().serializeToString(copy);
}

/** Los colores con los que se pinta el archivo exportado. */
export interface ExportPalette {
  readonly background: string;
}

/** Las relaciones supuestas que hay, para poder decirlo antes de exportar. */
export function suggestedCount(suggestions: readonly SuggestedRelation[] | undefined): number {
  return suggestions?.length ?? 0;
}
