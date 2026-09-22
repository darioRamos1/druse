import type * as MonacoApi from 'monaco-editor';

import {
  DatabaseEngine,
  KnownColumn,
  KnownRelation,
  SchemaIndex,
} from '../../../shared/models/workspace';
import { SqlReference, aliasMap, findRelation, relationMentions } from './sql-context';
import { SavedSnippet } from '../../../core/application-gateway/application-gateway';
import { functionsFor, keywordsFor } from './sql-keywords';
import { I18nService } from '../../../core/i18n/i18n.service';
import { describeReference, referenceFor, signatureLabel } from './sql-reference';
import { snippetsFor } from './sql-snippets';
import { statementAt } from './sql-statements';

/**
 * Cómo se describe una columna en una línea.
 *
 * El tipo primero, que es lo que se busca; después lo que cambia cómo se
 * escribe la consulta: si admite nulos y si es clave primaria.
 */
export function describeColumn(column: KnownColumn, i18n: I18nService): string {
  const partes = [column.dataType];

  if (!column.isNullable) {
    partes.push(i18n.t('sql.notNull'));
  }

  if (column.isPrimaryKey) {
    partes.push(i18n.t('sql.primaryKey'));
  }

  return partes.join(' · ');
}

/** Propone `oi` para `order_items` y `u` para `users`. */
function suggestedAlias(name: string): string {
  const words = name
    .replace(/([\p{Ll}\p{N}])(\p{Lu})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

  return words
    .map((word) => word[0])
    .join('')
    .toLowerCase();
}

/** Contexto que el editor consulta en cada pulsación para sugerir. */
export interface CompletionContext {
  readonly engine: DatabaseEngine;
  readonly schema: SchemaIndex;

  /**
   * Carga las columnas de una tabla que el explorador aún no ha abierto.
   *
   * Es opcional a propósito: sin esto el autocompletado sigue funcionando con lo
   * que ya está cargado, que es como se comportaba antes.
   */
  readonly loadColumns?: (schema: string | null, name: string) => Promise<readonly KnownColumn[]>;

  /**
   * Carga las tablas de un esquema que el explorador aún no ha recorrido.
   *
   * Al conectar se precalientan, pero un catálogo con muchos esquemas no se
   * precalienta entero: este es el camino para el resto.
   */
  readonly loadRelations?: (schema: string) => Promise<void>;

  /**
   * Fragmentos que el usuario guardó con nombre.
   *
   * Opcional para que el autocompletado siga funcionando sin ellos, que es como
   * se comportaba antes de que existieran.
   */
  readonly snippets?: readonly SavedSnippet[];
}

/**
 * Detecta si se está escribiendo tras un punto, y sobre qué.
 *
 * Un punto cambia por completo lo que tiene sentido sugerir, y hay dos casos
 * distintos que antes se trataban como uno:
 *
 * - `u.` o `users.` piden **columnas**;
 * - `tpublico.` pide **las tablas de ese esquema**.
 *
 * También se admite `esquema.tabla.`, porque quien escribe el nombre completo
 * sigue esperando sus columnas.
 */
function qualifierBefore(line: string): SqlReference | null {
  const identifier = '[\\p{L}_][\\p{L}\\p{N}_$]*';
  const match = new RegExp(
    `(?:(${identifier})\\.)?(${identifier})\\.\\s*[\\p{L}\\p{N}_$]*$`,
    'u',
  ).exec(line);

  return match ? { schema: match[1] ?? null, name: match[2] } : null;
}

/** Palabras detrás de las cuales lo que se escribe es una tabla, no una columna. */
const TABLE_POSITIONS = new Set(['FROM', 'JOIN', 'UPDATE', 'INTO', 'TABLE']);

/**
 * Palabras que dicen en qué parte de la instrucción está el cursor.
 *
 * `AS` no está a propósito: `FROM usuarios AS |` sigue siendo el FROM, y si
 * contara, lo último visto sería `AS` y se ofrecerían columnas donde se escribe
 * un alias.
 */
const CLAUSE_KEYWORD =
  /\b(SELECT|WHERE|AND|OR|NOT|ON|BY|SET|HAVING|FROM|JOIN|UPDATE|INTO|TABLE|VALUES|WHEN|THEN|ELSE|RETURNING|DISTINCT)\b/giu;

/**
 * ¿Lo que se está escribiendo es el nombre de una tabla?
 *
 * Se mira la última palabra de cláusula antes del cursor, **sin contar la que
 * se está tecleando**: escribir `on` para buscar la tabla `onboarding` no puede
 * convertirse en un `ON` que pida columnas.
 */
function expectsTable(textBeforeCursor: string): boolean {
  const withoutCurrentWord = textBeforeCursor.replace(/[\p{L}\p{N}_$]*$/u, '');
  let last: string | null = null;

  for (const match of withoutCurrentWord.matchAll(CLAUSE_KEYWORD)) {
    last = match[1].toUpperCase();
  }

  return last !== null && TABLE_POSITIONS.has(last);
}

/** Una tabla de la instrucción, con el nombre con el que se la califica. */
interface ColumnSource {
  /** El alias si lo hay; si no, el nombre de la tabla tal y como se escribió. */
  readonly qualifier: string;
  readonly relation: KnownRelation;
}

/**
 * Las tablas nombradas en la instrucción donde está el cursor.
 *
 * Una entrada por alias, no por tabla: `FROM users a JOIN users b` son dos
 * fuentes aunque sea la misma relación, y cada una necesita su calificador.
 */
function columnSources(sql: string, offset: number, index: SchemaIndex): ColumnSource[] | null {
  const statement = statementAt(sql, offset);

  if (!statement || expectsTable(sql.slice(statement.startOffset, offset))) {
    return null;
  }

  const sources = new Map<string, ColumnSource>();

  for (const mention of relationMentions(statement.text)) {
    const relation = findRelation(index, mention.reference);

    if (!relation || sources.has(mention.alias)) {
      continue;
    }

    // Sin alias, el calificador es el nombre tal como está escrito en el SQL:
    // `relationMentions` lo guarda en minúsculas, y en un PostgreSQL con nombres
    // entre comillas `Clientes` y `clientes` no son la misma tabla.
    const qualifier =
      mention.alias === mention.reference.name.toLowerCase()
        ? mention.reference.name
        : mention.alias;

    sources.set(mention.alias, { qualifier, relation });
  }

  return [...sources.values()];
}

/**
 * Registra el autocompletado SQL en Monaco.
 *
 * Devuelve la función para retirarlo: sin eso, cada editor que se abriera
 * añadiría otro proveedor y las sugerencias saldrían repetidas.
 */
export function registerSqlCompletion(
  monaco: typeof MonacoApi,
  i18n: I18nService,
  getContext: () => CompletionContext,
): () => void {
  const provider = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.'],

    provideCompletionItems(model, position) {
      const { engine, schema, loadColumns, loadRelations, snippets } = getContext();

      const word = model.getWordUntilPosition(position);
      const range: MonacoApi.IRange = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      };

      const lineUntilPosition = model.getValueInRange({
        startLineNumber: position.lineNumber,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column,
      });

      const qualifier = qualifierBefore(lineUntilPosition);

      // --- Tras el punto de un esquema: sus tablas y vistas ------------------
      //
      // Es el caso de `FROM tpublico.`. Antes se buscaba una tabla llamada
      // `tpublico`, no se encontraba y el desplegable salía vacío justo donde
      // más falta hace: en una base cuyo esquema no es el de por omisión.
      if (qualifier && !qualifier.schema) {
        const schemaName = schema.schemas.find(
          (candidate) => candidate.toLowerCase() === qualifier.name.toLowerCase(),
        );

        if (schemaName) {
          const relationsOf = (index: SchemaIndex) =>
            index.relations.filter(
              (candidate) => candidate.schema.toLowerCase() === schemaName.toLowerCase(),
            );

          const relations = relationsOf(schema);

          // El esquema existe pero sus tablas no se han traído: se piden ahora.
          // Después hay que releer el contexto, porque el índice lo produce una
          // señal que acaba de cambiar.
          if (relations.length === 0 && loadRelations) {
            return loadRelations(schemaName).then(() =>
              relationItems(relationsOf(getContext().schema)),
            );
          }

          return relationItems(relations);
        }
      }

      /** Tablas y vistas de un esquema, ya sin su nombre delante. */
      function relationItems(relations: readonly KnownRelation[]) {
        return {
          suggestions: relations.flatMap((relation) => relationItemsFor(relation, false)),
        };
      }

      /** Ofrece cada relación tal cual y con un alias breve que se puede editar. */
      function relationItemsFor(
        relation: KnownRelation,
        includeSchema: boolean,
      ): MonacoApi.languages.CompletionItem[] {
        const kind =
          relation.kind === 'view'
            ? monaco.languages.CompletionItemKind.Interface
            : monaco.languages.CompletionItemKind.Struct;
        const insertName = includeSchema ? relation.qualified : relation.name;
        const detail =
          relation.columns.length > 0
            ? i18n.t('sql.completion.columns', {
                qualified: relation.qualified,
                count: relation.columns.length,
              })
            : relation.qualified;
        const alias = suggestedAlias(relation.name);

        return [
          {
            label: relation.name,
            kind,
            insertText: insertName,
            detail,
            sortText: `0_${relation.name}_0`,
            range,
          },
          {
            label: `${relation.name} AS ${alias}`,
            kind,
            insertText: `${insertName} AS \${1:${alias}}`,
            insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            detail: i18n.t('sql.completion.withAlias', { detail }),
            sortText: `0_${relation.name}_1`,
            range,
          },
        ];
      }

      // --- Tras un punto: solo columnas de esa relación --------------------
      if (qualifier) {
        const aliases = aliasMap(model.getValue());
        const target = qualifier.schema
          ? qualifier
          : (aliases.get(qualifier.name.toLowerCase()) ?? {
              schema: null,
              name: qualifier.name.toLowerCase(),
            });

        const columnItems = (relation: KnownRelation, columns: readonly KnownColumn[]) => ({
          suggestions: columns.map((column, index) => ({
            label: column.name,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: column.name,
            // El tipo a la derecha evita ir a mirar la tabla para saber si algo
            // es un texto, una fecha o un número.
            detail: describeColumn(column, i18n),
            documentation: `${relation.qualified}.${column.name}`,
            // El orden del catálogo es el de la tabla, que es más útil que el
            // alfabético para quien conoce su esquema.
            sortText: index.toString().padStart(4, '0'),
            range,
          })),
        });

        const columnsFor = (relation: KnownRelation) => {
          // La tabla está en el árbol pero nadie la ha abierto: se piden sus
          // columnas ahora, una sola vez. Antes el desplegable salía vacío y la
          // única salida era ir a expandirla en el explorador.
          if (relation.columns.length === 0 && loadColumns) {
            return loadColumns(relation.schema || null, relation.name).then((columns) =>
              columnItems(relation, columns),
            );
          }

          return columnItems(relation, relation.columns);
        };

        const relation = findRelation(schema, target);

        if (relation) {
          return columnsFor(relation);
        }

        // Al retomar un SQL, su esquema puede quedar fuera de los primeros que
        // se precargan. El alias ya dice `esquema.tabla`, así que se puede traer
        // esa rama sin obligar a abrirla antes en el explorador.
        if (target.schema && loadRelations) {
          return loadRelations(target.schema).then(() => {
            const loaded = findRelation(getContext().schema, target);

            return loaded ? columnsFor(loaded) : { suggestions: [] };
          });
        }

        return { suggestions: [] };
      }

      // --- En cualquier otro sitio -----------------------------------------
      const suggestions: MonacoApi.languages.CompletionItem[] = [];

      for (const relation of schema.relations) {
        // El nombre calificado siempre funciona aunque la relación no esté en
        // el esquema por omisión del usuario.
        suggestions.push(...relationItemsFor(relation, true));
      }

      for (const schemaName of schema.schemas) {
        suggestions.push({
          label: schemaName,
          kind: monaco.languages.CompletionItemKind.Module,
          insertText: schemaName,
          detail: 'esquema',
          sortText: `1_${schemaName}`,
          range,
        });
      }

      // Lista explícita de columnas de lo que ya está en el FROM.
      //
      // Es lo que más se teclea a mano en un cliente SQL: cambiar el `*` por los
      // nombres para quitar dos columnas. Solo aparece si esa tabla tiene ya sus
      // columnas cargadas; si no, no habría nada que insertar.
      // Una tabla se registra con su alias y con su propio nombre, así que hay
      // que quedarse con una sola entrada por tabla; si no, `FROM usuarios u`
      // ofrecería «columnas de u» y «columnas de usuarios», que son lo mismo.
      const yaOfrecidas = new Set<string>();

      for (const [alias, reference] of aliasMap(model.getValue())) {
        const relation = findRelation(schema, reference);

        if (!relation || relation.columns.length === 0 || yaOfrecidas.has(relation.qualified)) {
          continue;
        }

        yaOfrecidas.add(relation.qualified);

        const prefijo = alias === reference.name ? '' : `${alias}.`;

        suggestions.push({
          label: i18n.t('sql.completion.allColumns', { alias }),
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: relation.columns.map((column) => `${prefijo}${column.name}`).join(', '),
          detail: i18n.t('sql.completion.columns', {
            qualified: relation.qualified,
            count: relation.columns.length,
          }),
          sortText: `00_${alias}`,
          range,
        });
      }

      // Por delante de las plantillas de fábrica: estos los guardó el usuario, y
      // se escriben buscando el nombre que él mismo les puso.
      for (const saved of snippets ?? []) {
        suggestions.push({
          label: saved.name,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: saved.sql,
          detail: i18n.t('sql.completion.savedSnippet'),
          documentation: { value: ['```sql', saved.sql, '```'].join('\n') },
          sortText: `1_${saved.name}`,
          range,
        });
      }

      for (const snippet of snippetsFor(engine, i18n)) {
        suggestions.push({
          label: snippet.trigger,
          kind: monaco.languages.CompletionItemKind.Snippet,
          insertText: snippet.body,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          detail: snippet.description,
          documentation: {
            value: `\`\`\`sql\n${snippet.body.replace(/\$\{\d+:?([^}]*)\}/g, '$1')}\n\`\`\``,
          },
          // Detrás de las tablas y por delante de las reservadas: se buscan a
          // propósito, escribiendo su nombre.
          sortText: `2_${snippet.trigger}`,
          range,
        });
      }

      for (const keyword of keywordsFor(engine)) {
        const reference = referenceFor(keyword, engine);

        suggestions.push({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          // La explicación va en el panel lateral del desplegable: se lee al
          // dudar entre dos opciones, sin salir del editor a buscarla.
          ...(reference ? { documentation: { value: describeReference(reference) } } : {}),
          sortText: `3_${keyword}`,
          range,
        });
      }

      for (const fn of functionsFor(engine)) {
        const reference = referenceFor(fn, engine);
        const sinArgumentos = reference?.params?.length === 0;

        suggestions.push({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          // Sin argumentos se cierra el paréntesis: `NOW()` no tiene nada que
          // rellenar, y dejar el cursor dentro obligaba a salir con una flecha.
          insertText: sinArgumentos ? `${fn}()` : `${fn}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          ...(reference
            ? {
                detail: signatureLabel(reference),
                documentation: { value: describeReference(reference, { signature: false }) },
              }
            : {}),
          // Al aceptarla se abre la ayuda de parámetros: es justo el momento en
          // que hace falta saber qué va dentro.
          ...(sinArgumentos
            ? {}
            : { command: { id: 'editor.action.triggerParameterHints', title: '' } }),
          sortText: `4_${fn}`,
          range,
        });
      }

      // Columnas sueltas de las tablas de la instrucción, sin alias delante.
      //
      // Hasta ahora las columnas solo aparecían detrás de un punto: quien escribe
      // `SELECT nom` sobre `FROM usuarios`, sin alias, no recibía nada y tenía
      // que ir a mirar la tabla o escribir `usuarios.` para que le sugiriera.
      const sources = columnSources(model.getValue(), model.getOffsetAt(position), schema);

      const bareColumnItems = (
        loaded: readonly (ColumnSource & { readonly columns: readonly KnownColumn[] })[],
      ): MonacoApi.languages.CompletionItem[] => {
        // Una columna que está en dos tablas no se puede escribir suelta: el
        // motor la rechazaría por ambigua. Esas se ofrecen ya calificadas.
        const repeticiones = new Map<string, number>();

        for (const source of loaded) {
          for (const column of source.columns) {
            const key = column.name.toLowerCase();
            repeticiones.set(key, (repeticiones.get(key) ?? 0) + 1);
          }
        }

        return loaded.flatMap((source, sourceIndex) =>
          source.columns.map((column, columnIndex) => {
            const ambigua = (repeticiones.get(column.name.toLowerCase()) ?? 0) > 1;
            const texto = ambigua ? `${source.qualifier}.${column.name}` : column.name;

            return {
              label: texto,
              kind: monaco.languages.CompletionItemKind.Field,
              insertText: texto,
              // Se filtra por el nombre de la columna aunque se inserte
              // calificada: quien busca `id` escribe `id`, no `users.id`.
              filterText: column.name,
              detail: `${source.qualifier} · ${describeColumn(column, i18n)}`,
              documentation: `${source.relation.qualified}.${column.name}`,
              // Delante de las tablas —donde se piden columnas es lo que se
              // busca— y en el orden de cada tabla, que es el que conoce quien
              // conoce su esquema.
              sortText: `01_${String(sourceIndex).padStart(2, '0')}_${String(columnIndex).padStart(4, '0')}`,
              range,
            };
          }),
        );
      };

      if (sources && sources.length > 0) {
        const faltan = sources.some((source) => source.relation.columns.length === 0);

        // Como tras el punto: una tabla que nadie ha abierto en el explorador
        // trae sus columnas ahora, una sola vez, en lugar de quedarse fuera.
        if (faltan && loadColumns) {
          const conColumnas = Promise.all(
            sources.map(async (source) => ({
              ...source,
              columns:
                source.relation.columns.length > 0
                  ? source.relation.columns
                  : await loadColumns(source.relation.schema || null, source.relation.name),
            })),
          );

          return conColumnas.then((loaded) => ({
            suggestions: [...suggestions, ...bareColumnItems(loaded)],
          }));
        }

        suggestions.push(
          ...bareColumnItems(
            sources.map((source) => ({ ...source, columns: source.relation.columns })),
          ),
        );
      }

      return { suggestions };
    },
  });

  return () => provider.dispose();
}
