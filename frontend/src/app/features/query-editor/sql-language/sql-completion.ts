import type * as MonacoApi from 'monaco-editor';

import { DatabaseEngine, SchemaIndex } from '../../../shared/models/workspace';
import { functionsFor, keywordsFor } from './sql-keywords';

/** Contexto que el editor consulta en cada pulsación para sugerir. */
export interface CompletionContext {
  readonly engine: DatabaseEngine;
  readonly schema: SchemaIndex;
}

/**
 * Detecta si se está escribiendo tras un punto, y sobre qué.
 *
 * `u.` o `users.` cambian por completo lo que tiene sentido sugerir: allí van
 * columnas, no palabras reservadas. Sin esto, el desplegable ofrecería `SELECT`
 * justo después de un punto, que es imposible.
 */
function qualifierBefore(line: string): string | null {
  const match = /([\p{L}_][\p{L}\p{N}_$]*)\.\s*[\p{L}\p{N}_$]*$/u.exec(line);

  return match ? match[1] : null;
}

/**
 * Busca los alias declarados en el texto.
 *
 * `FROM users u` y `JOIN pedidos AS p` son la forma normal de escribir SQL, y
 * sin resolverlos las columnas nunca se sugerirían: el usuario escribe `u.` y
 * el editor no sabría que `u` es `users`.
 */
function aliasMap(sql: string): Map<string, string> {
  const aliases = new Map<string, string>();
  const pattern =
    /\b(?:FROM|JOIN|UPDATE|INTO)\s+([\p{L}_][\p{L}\p{N}_$]*(?:\.[\p{L}_][\p{L}\p{N}_$]*)?)(?:\s+(?:AS\s+)?([\p{L}_][\p{L}\p{N}_$]*))?/giu;

  let match: RegExpExecArray | null;

  while ((match = pattern.exec(sql)) !== null) {
    const [, relation, alias] = match;
    const bare = relation.includes('.') ? relation.split('.').pop()! : relation;

    // Palabras que no son alias aunque ocupen su sitio.
    if (alias && !['WHERE', 'ON', 'INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS', 'JOIN', 'GROUP', 'ORDER', 'SET', 'VALUES'].includes(alias.toUpperCase())) {
      aliases.set(alias.toLowerCase(), bare.toLowerCase());
    }

    aliases.set(bare.toLowerCase(), bare.toLowerCase());
  }

  return aliases;
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
      const { engine, schema } = getContext();

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

      // --- Tras un punto: solo columnas de esa relación --------------------
      if (qualifier) {
        const aliases = aliasMap(model.getValue());
        const target = aliases.get(qualifier.toLowerCase()) ?? qualifier.toLowerCase();

        const relation = schema.relations.find(
          (candidate) => candidate.name.toLowerCase() === target,
        );

        if (!relation) {
          return { suggestions: [] };
        }

        return {
          suggestions: relation.columns.map((column, index) => ({
            label: column,
            kind: monaco.languages.CompletionItemKind.Field,
            insertText: column,
            detail: relation.qualified,
            // El orden del catálogo es el de la tabla, que es más útil que el
            // alfabético para quien conoce su esquema.
            sortText: index.toString().padStart(4, '0'),
            range,
          })),
        };
      }

      // --- En cualquier otro sitio -----------------------------------------
      const suggestions: MonacoApi.languages.CompletionItem[] = [];

      for (const relation of schema.relations) {
        suggestions.push({
          label: relation.name,
          kind: relation.kind === 'view'
            ? monaco.languages.CompletionItemKind.Interface
            : monaco.languages.CompletionItemKind.Struct,
          insertText: relation.name,
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
