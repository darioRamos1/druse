import type * as MonacoApi from 'monaco-editor';

import { DatabaseEngine, KnownRelation, SchemaIndex } from '../../../shared/models/workspace';
import { functionsFor, keywordsFor } from './sql-keywords';

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
  readonly loadColumns?: (schema: string | null, name: string) => Promise<readonly string[]>;

  /**
   * Carga las tablas de un esquema que el explorador aún no ha recorrido.
   *
   * Al conectar se precalientan, pero un catálogo con muchos esquemas no se
   * precalienta entero: este es el camino para el resto.
   */
  readonly loadRelations?: (schema: string) => Promise<void>;
}

/** Una relación nombrada en el SQL, con su esquema si el usuario lo escribió. */
interface Reference {
  readonly schema: string | null;
  readonly name: string;
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
function qualifierBefore(line: string): Reference | null {
  const identifier = '[\\p{L}_][\\p{L}\\p{N}_$]*';
  const match = new RegExp(
    `(?:(${identifier})\\.)?(${identifier})\\.\\s*[\\p{L}\\p{N}_$]*$`,
    'u',
  ).exec(line);

  return match ? { schema: match[1] ?? null, name: match[2] } : null;
}

/**
 * Busca los alias declarados en el texto.
 *
 * `FROM users u` y `JOIN pedidos AS p` son la forma normal de escribir SQL, y
 * sin resolverlos las columnas nunca se sugerirían: el usuario escribe `u.` y
 * el editor no sabría que `u` es `users`.
 *
 * Se conserva el esquema cuando la relación viene calificada: en una base con
 * dos esquemas que tengan una tabla del mismo nombre, es lo único que permite
 * sugerir las columnas correctas.
 */
function aliasMap(sql: string): Map<string, Reference> {
  const aliases = new Map<string, Reference>();
  const pattern =
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+([\p{L}_][\p{L}\p{N}_$]*(?:\.[\p{L}_][\p{L}\p{N}_$]*)?)(?:\s+(?:AS\s+)?([\p{L}_][\p{L}\p{N}_$]*))?/giu;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(sql)) !== null) {
    const [, relation, alias] = match;
    const parts = relation.split('.');
    const reference: Reference = {
      schema: parts.length > 1 ? parts[0].toLowerCase() : null,
      name: parts[parts.length - 1].toLowerCase(),
    };

    // Palabras que no son alias aunque ocupen su sitio.
    if (alias && !['WHERE', 'ON', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN', 'GROUP', 'ORDER', 'SET', 'VALUES'].includes(alias.toUpperCase())) {
      aliases.set(alias.toLowerCase(), reference);
    }

    aliases.set(reference.name, reference);
  }

  return aliases;
}

/**
 * Busca la relación a la que apunta una referencia.
 *
 * Cuando el esquema es conocido manda él; sin esquema se acepta la primera
 * coincidencia por nombre, que es lo único que se puede hacer sin analizar el
 * `search_path` del servidor.
 */
function findRelation(index: SchemaIndex, reference: Reference): KnownRelation | undefined {
  const byName = index.relations.filter(
    (candidate) => candidate.name.toLowerCase() === reference.name,
  );

  if (!reference.schema) {
    return byName[0];
  }

  return byName.find((candidate) => candidate.schema.toLowerCase() === reference.schema);
}

/**
 * Registra el autocompletado SQL en Monaco.
 *
 * Devuelve la función para retirarlo: sin eso, cada editor que se abriera
 * añadiría otro proveedor y las sugerencias saldrían repetidas.
 */
export function registerSqlCompletion(
  monaco: typeof MonacoApi,
  getContext: () => CompletionContext,
): () => void {
  const provider = monaco.languages.registerCompletionItemProvider('sql', {
    triggerCharacters: ['.'],

    provideCompletionItems(model, position) {
      const { engine, schema, loadColumns, loadRelations } = getContext();

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
          suggestions: relations.map((relation) => ({
            label: relation.name,
            kind: relation.kind === 'view'
              ? monaco.languages.CompletionItemKind.Interface
              : monaco.languages.CompletionItemKind.Struct,
            // Sin el esquema: el usuario acaba de escribirlo.
            insertText: relation.name,
            detail: relation.columns.length > 0
              ? `${relation.qualified} · ${relation.columns.length} columnas`
              : relation.qualified,
            sortText: `0_${relation.name}`,
            range,
          })),
        };
      }

      // --- Tras un punto: solo columnas de esa relación --------------------
      if (qualifier) {
        const aliases = aliasMap(model.getValue());
        const target = qualifier.schema
          ? qualifier
          : aliases.get(qualifier.name.toLowerCase()) ?? {
              schema: null,
              name: qualifier.name.toLowerCase(),
            };

        const relation = findRelation(schema, target);

        if (!relation) {
          return { suggestions: [] };
        }

        const columnItems = (columns: readonly string[]) => ({
          suggestions: columns.map((column, index) => ({
            label: column,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: column,
            detail: relation.qualified,
            // El orden del catálogo es el de la tabla, que es más útil que el
            // alfabético para quien conoce su esquema.
            sortText: index.toString().padStart(4, '0'),
            range,
          })),
        });

        // La tabla está en el árbol pero nadie la ha abierto: se piden sus
        // columnas ahora, una sola vez. Antes el desplegable salía vacío y la
        // única salida era ir a expandirla en el explorador.
        if (relation.columns.length === 0 && loadColumns) {
          return loadColumns(relation.schema || null, relation.name).then(columnItems);
        }

        return columnItems(relation.columns);
      }

      // --- En cualquier otro sitio -----------------------------------------
      const suggestions: MonacoApi.languages.CompletionItem[] = [];

      for (const relation of schema.relations) {
        suggestions.push({
          label: relation.name,
          kind: relation.kind === 'view'
            ? monaco.languages.CompletionItemKind.Interface
            : monaco.languages.CompletionItemKind.Struct,
          // Se inserta el nombre calificado, que es el que siempre funciona:
          // `usuarios` a secas solo vale si la tabla está en el esquema por
          // omisión del usuario, y eso el cliente no lo sabe. Es además lo que
          // ya hace el explorador al abrir un `SELECT` desde una tabla.
          //
          // La etiqueta se queda con el nombre corto, que es por el que se
          // busca en el desplegable.
          insertText: relation.qualified,
          detail: relation.columns.length > 0
            ? `${relation.qualified} · ${relation.columns.length} columnas`
            : relation.qualified,
          // Las tablas van primero: es lo que más se escribe.
          sortText: `0_${relation.name}`,
          range,
        });
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

      for (const keyword of keywordsFor(engine)) {
        suggestions.push({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          sortText: `2_${keyword}`,
          range,
        });
      }

      for (const fn of functionsFor(engine)) {
        suggestions.push({
          label: fn,
          kind: monaco.languages.CompletionItemKind.Function,
          insertText: `${fn}($0)`,
          insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
          sortText: `3_${fn}`,
          range,
        });
      }

      return { suggestions };
    },
  });

  return () => provider.dispose();
}
