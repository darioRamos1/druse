import { DatabaseObject, TableDetail } from '../../shared/models/workspace';

/** Lo que el asistente sabe de la base, ya compuesto y listo para enviar. */
export interface AiSchemaContext {
  /** El texto que viaja. Vacío cuando no hay nada que contar. */
  readonly schema: string;
  /** Nombres calificados de lo que va dentro, para poder enseñarlos. */
  readonly tables: readonly string[];
}

function quote(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

export function qualifiedName(table: Pick<DatabaseObject, 'schema' | 'name'>): string {
  return table.schema ? `${quote(table.schema)}.${quote(table.name)}` : quote(table.name);
}

/** Los motores basados en archivo pueden usar una ruta al conectar y un alias en el catálogo. */
export function resolveAiDatabase(
  database: string,
  catalog: readonly string[],
  usesFilePath: boolean,
): string {
  return !catalog.includes(database) && usesFilePath && catalog.length === 1
    ? catalog[0]
    : database;
}

/** La selección explícita no se recorta: una FK compuesta necesita todas sus columnas. */
export function describeSelectedTables(details: readonly TableDetail[]): AiSchemaContext {
  const schema = details
    .map(({ table, columns, structure }) => {
      const name = qualifiedName(table);
      const lines = [...columns]
        .sort((a, b) => a.ordinal - b.ordinal)
        .map(
          (column) =>
            `  ${quote(column.name)} ${column.dataType}${column.isNullable ? '' : ' NOT NULL'}${
              column.defaultValue == null ? '' : ` DEFAULT ${column.defaultValue}`
            }${column.isGenerated ? ' GENERATED' : ''}`,
        );
      const names = (values: readonly string[]) => values.map(quote).join(', ');
      const actions = {
        noAction: 'NO ACTION',
        cascade: 'CASCADE',
        setNull: 'SET NULL',
        setDefault: 'SET DEFAULT',
      };
      if (structure.primaryKey)
        lines.push(`  PRIMARY KEY (${names(structure.primaryKey.columns)})`);
      for (const key of structure.foreignKeys) {
        lines.push(
          `  CONSTRAINT ${quote(key.name)} FOREIGN KEY (${names(key.columns)}) REFERENCES ${qualifiedName(
            { schema: key.referencedSchema ?? table.schema, name: key.referencedTable },
          )} (${names(key.referencedColumns)}) ON DELETE ${actions[key.onDelete]} ON UPDATE ${actions[key.onUpdate]}`,
        );
      }
      for (const constraint of structure.uniqueConstraints)
        lines.push(`  CONSTRAINT ${quote(constraint.name)} UNIQUE (${names(constraint.columns)})`);
      for (const constraint of structure.checkConstraints) {
        if (constraint.expression)
          lines.push(`  CONSTRAINT ${quote(constraint.name)} CHECK (${constraint.expression})`);
      }
      const indexes = structure.indexes
        .filter((index) => !index.isPrimaryKey)
        .map(
          (index) =>
            `${index.isUnique ? 'UNIQUE ' : ''}INDEX ${quote(index.name)} ON ${name}${index.method ? ` USING ${index.method}` : ''} (${index.columns.map((column) => `${quote(column.name)}${column.direction === 'desc' ? ' DESC' : ''}`).join(', ')})${
              index.includedColumns.length ? ` INCLUDE (${names(index.includedColumns)})` : ''
            }${index.filter ? ` WHERE ${index.filter}` : ''};`,
        );
      return [
        `${table.kind === 'view' ? 'VIEW' : 'TABLE'} ${name} (\n${lines.join(',\n')}\n);`,
        ...indexes,
      ].join('\n');
    })
    .join('\n\n');
  return { schema, tables: details.map((detail) => qualifiedName(detail.table)) };
}
