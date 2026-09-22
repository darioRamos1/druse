import { Injectable } from '@angular/core';

import { ExplorerNode } from '../../shared/models/workspace';

/**
 * Una consulta que salió del compositor, con lo necesario para reabrirla.
 *
 * `state` es el formulario tal como lo entiende el compositor; aquí no se mira
 * por dentro, solo se guarda y se devuelve.
 */
export interface ComposedQuery {
  readonly sql: string;
  readonly state: unknown;
  /** La tabla sobre la que se compuso, como la da el explorador. */
  readonly node: ExplorerNode;
}

/** Dónde se recuerdan, en el almacenamiento del navegador. */
const STORAGE_KEY = 'druse.composed-queries.v1';

/**
 * Cuántas se recuerdan.
 *
 * Es un atajo para volver al formulario de algo recién compuesto, no un
 * archivo: las más viejas se olvidan, y perderlas no pierde nada, porque el
 * SQL sigue en su pestaña.
 */
const MAX_ENTRIES = 30;

/**
 * Las consultas que el compositor mandó al editor, para poder reabrirlas.
 *
 * **Solo reconoce lo que salió del compositor tal cual.** Se busca por el SQL,
 * sin contar espacios, saltos de línea ni el punto y coma final; si alguien lo
 * retoca a mano, deja de coincidir y no se reabre. Es a propósito: adivinar el
 * formulario de un SQL cambiado produciría uno que no escribe lo mismo.
 */
@Injectable({ providedIn: 'root' })
export class ComposedQueries {
  private _entries: ComposedQuery[] = read();

  remember(entry: ComposedQuery): void {
    const key = normalizeSql(entry.sql);

    this._entries = [
      entry,
      ...this._entries.filter((item) => normalizeSql(item.sql) !== key),
    ].slice(0, MAX_ENTRIES);

    write(this._entries);
  }

  /** La consulta compuesta que coincide con este SQL, si la hay. */
  find(sql: string): ComposedQuery | undefined {
    const key = normalizeSql(sql);

    return key.length === 0
      ? undefined
      : this._entries.find((item) => normalizeSql(item.sql) === key);
  }
}

/**
 * El SQL sin lo que no cambia su significado para esta comparación: espacios
 * repetidos, saltos de línea y el punto y coma final.
 */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().replace(/;\s*$/, '').trim();
}

function read(): ComposedQuery[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];

    return Array.isArray(parsed) ? (parsed as ComposedQuery[]) : [];
  } catch {
    return [];
  }
}

function write(entries: readonly ComposedQuery[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Sin almacenamiento se recuerdan mientras Druse siga abierto.
  }
}
