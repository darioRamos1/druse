import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import {
  DatabaseColumn,
  DatabaseObject,
  EngineInfo,
  IndexCapabilities,
  QueryHistoryEntry,
  QueryResult,
  ResultColumn,
  ResultSet,
  SavedConnection,
  SecretStoreStatus,
  SessionInfo,
  TableAlteration,
  TableDesign,
  TableStructure,
  TestConnectionResult,
} from '../../shared/models/workspace';
import {
  ApplicationGateway,
  ConnectRequest,
  ExecuteQueryRequest,
  ExportRequest,
  ImportOptions,
  ImportPreview,
  RowEditRequest,
  RowEditResult,
  TableChangeResult,
  TransactionState,
  HealthStatus,
  SaveConnectionRequest,
} from './application-gateway';

/** Forma en que la API devuelve un conjunto de resultados. */
interface ResultSetDto {
  readonly columns: readonly { name: string; dataType: string; ordinal: number }[];
  readonly rows: readonly (readonly (string | null)[])[];
  readonly truncated: boolean;
}

interface QueryResultDto extends Omit<QueryResult, 'resultSets'> {
  readonly resultSets: readonly ResultSetDto[];
}

/**
 * Anchos por defecto de columna según el tipo, en píxeles.
 *
 * Ajustar el ancho al contenido exigiría medir el texto renderizado; partir de
 * una estimación por tipo acierta lo suficiente y no cuesta nada.
 */
const WIDTH_BY_KIND: Readonly<Record<ResultColumn['kind'], number>> = {
  number: 110,
  boolean: 110,
  timestamp: 200,
  uuid: 290,
  binary: 200,
  text: 220,
};

/**
 * Implementación del gateway sobre HTTP contra la API local.
 *
 * Las rutas son relativas a propósito: en desarrollo las resuelve el proxy de
 * Angular hacia 127.0.0.1 y en producción las resolverá el host que empaquete la
 * aplicación. Ningún componente debe conocer host ni puerto.
 */
@Injectable()
export class HttpApplicationGateway extends ApplicationGateway {
  private readonly _http = inject(HttpClient);

  override getHealth(): Observable<HealthStatus> {
    return this._http.get<HealthStatus>('/api/health');
  }

  override getEngines(): Observable<readonly EngineInfo[]> {
    return this._http.get<EngineInfo[]>('/api/engines');
  }

  override testConnection(request: ConnectRequest): Observable<TestConnectionResult> {
    return this._http.post<TestConnectionResult>('/api/connections/test', request);
  }

  override openSession(request: ConnectRequest): Observable<SessionInfo> {
    return this._http.post<SessionInfo>('/api/sessions', request);
  }

  override closeSession(sessionId: string): Observable<void> {
    return this._http.delete<void>(`/api/sessions/${sessionId}`);
  }

  override getDatabases(sessionId: string): Observable<readonly DatabaseObject[]> {
    return this._http.get<DatabaseObject[]>(`/api/sessions/${sessionId}/metadata/databases`);
  }

  override getChildren(
    sessionId: string,
    parent: DatabaseObject,
  ): Observable<readonly DatabaseObject[]> {
    return this._http.post<DatabaseObject[]>(
      `/api/sessions/${sessionId}/metadata/children`,
      parent,
    );
  }

  override getColumns(
    sessionId: string,
    table: DatabaseObject,
  ): Observable<readonly DatabaseColumn[]> {
    return this._http.post<DatabaseColumn[]>(`/api/sessions/${sessionId}/metadata/columns`, table);
  }

  override getDefinition(sessionId: string, databaseObject: DatabaseObject): Observable<string> {
    return this._http
      .post<{ sql: string }>(`/api/sessions/${sessionId}/metadata/definition`, databaseObject)
      .pipe(map((response) => response.sql));
  }

  override executeQuery(request: ExecuteQueryRequest): Observable<QueryResult> {
    return this._http
      .post<QueryResultDto>('/api/queries', request)
      .pipe(map((dto) => this.toQueryResult(dto)));
  }

  override cancelQuery(executionId: string): Observable<void> {
    return this._http.delete<void>(`/api/queries/${executionId}`);
  }

  override getTransaction(sessionId: string): Observable<TransactionState> {
    return this._http.get<TransactionState>(`/api/sessions/${sessionId}/transaction`);
  }

  override beginTransaction(sessionId: string): Observable<TransactionState> {
    return this._http.post<TransactionState>(`/api/sessions/${sessionId}/transaction`, {});
  }

  // Confirmar y deshacer tienen ruta propia en lugar de compartir una con un
  // parámetro: son las dos decisiones opuestas del usuario, y equivocarse de
  // valor tiraría el trabajo en lugar de guardarlo.
  override commitTransaction(sessionId: string): Observable<TransactionState> {
    return this._http.post<TransactionState>(`/api/sessions/${sessionId}/transaction/commit`, {});
  }

  override rollbackTransaction(sessionId: string): Observable<TransactionState> {
    return this._http.post<TransactionState>(`/api/sessions/${sessionId}/transaction/rollback`, {});
  }

  override previewRowEdits(request: RowEditRequest): Observable<readonly string[]> {
    return this._http
      .post<{ statements: string[] }>('/api/rows/preview', request)
      .pipe(map((response) => response.statements));
  }

  override applyRowEdits(request: RowEditRequest): Observable<RowEditResult> {
    return this._http.post<RowEditResult>('/api/rows', request);
  }

  // --- Diseño de tablas -----------------------------------------------------

  override getTableDataTypes(sessionId: string): Observable<readonly string[]> {
    return this._http.get<string[]>(`/api/sessions/${sessionId}/tables/data-types`);
  }

  override getTableCapabilities(sessionId: string): Observable<IndexCapabilities> {
    return this._http.get<IndexCapabilities>(`/api/sessions/${sessionId}/tables/capabilities`);
  }

  override getTableStructure(
    sessionId: string,
    table: DatabaseObject,
  ): Observable<TableStructure> {
    return this._http.post<TableStructure>(
      `/api/sessions/${sessionId}/tables/structure`,
      table,
    );
  }

  override previewCreateTable(
    sessionId: string,
    table: TableDesign,
  ): Observable<readonly string[]> {
    return this._http
      .post<{ statements: string[] }>('/api/tables/preview', { sessionId, ...table })
      .pipe(map((response) => response.statements));
  }

  override createTable(sessionId: string, table: TableDesign): Observable<TableChangeResult> {
    // La confirmación viaja siempre en `true` desde aquí porque este método solo
    // se llama después de que el usuario haya visto el SQL y haya dicho que sí.
    return this._http.post<TableChangeResult>('/api/tables', {
      sessionId,
      ...table,
      confirmed: true,
    });
  }

  override previewAlterTable(
    sessionId: string,
    alteration: TableAlteration,
  ): Observable<readonly string[]> {
    return this._http
      .post<{ statements: string[] }>('/api/tables/alter/preview', { sessionId, ...alteration })
      .pipe(map((response) => response.statements));
  }

  override alterTable(
    sessionId: string,
    alteration: TableAlteration,
    confirmedDestructive: boolean,
  ): Observable<TableChangeResult> {
    return this._http.post<TableChangeResult>('/api/tables/alter', {
      sessionId,
      ...alteration,
      confirmed: true,
      confirmedDestructive,
    });
  }

  override previewImport(
    sessionId: string,
    table: DatabaseObject,
    file: File,
    options: ImportOptions,
  ): Observable<ImportPreview> {
    return this._http.post<ImportPreview>(
      '/api/imports/preview',
      form(sessionId, table, file, options),
    );
  }

  override runImport(
    sessionId: string,
    table: DatabaseObject,
    file: File,
    options: ImportOptions,
  ): Observable<RowEditResult> {
    return this._http.post<RowEditResult>('/api/imports', form(sessionId, table, file, options));
  }

  override getSavedConnections(): Observable<readonly SavedConnection[]> {
    return this._http.get<SavedConnection[]>('/api/connections');
  }

  override getSecretStoreStatus(): Observable<SecretStoreStatus> {
    return this._http.get<SecretStoreStatus>('/api/connections/secret-store');
  }

  override saveConnection(request: SaveConnectionRequest): Observable<SavedConnection> {
    return this._http.post<SavedConnection>('/api/connections', request);
  }

  override updateConnection(
    id: string,
    request: SaveConnectionRequest,
  ): Observable<SavedConnection> {
    return this._http.put<SavedConnection>(`/api/connections/${id}`, request);
  }

  override deleteConnection(id: string): Observable<void> {
    return this._http.delete<void>(`/api/connections/${id}`);
  }

  override openSavedSession(id: string, password?: string): Observable<SessionInfo> {
    return this._http.post<SessionInfo>(`/api/connections/${id}/sessions`, { password });
  }

  override getHistory(search?: string): Observable<readonly QueryHistoryEntry[]> {
    const query = search ? `?search=${encodeURIComponent(search)}` : '';

    return this._http.get<QueryHistoryEntry[]>(`/api/history${query}`);
  }

  override clearHistory(): Observable<void> {
    return this._http.delete<void>('/api/history');
  }

  override getPreferences(): Observable<Readonly<Record<string, string>>> {
    return this._http.get<Record<string, string>>('/api/preferences');
  }

  override setPreference(key: string, value: string): Observable<void> {
    return this._http.put<void>(`/api/preferences/${encodeURIComponent(key)}`, { value });
  }

  override exportQuery(request: ExportRequest): Observable<Blob> {
    const { format, ...body } = request;

    // La respuesta es un archivo, no JSON: sin `responseType` Angular intentaría
    // interpretarlo y fallaría con el primer byte binario.
    return this._http.post(`/api/exports/${format}`, body, { responseType: 'blob' });
  }

  /** Añade lo que la cuadrícula necesita y la API no tiene por qué saber. */
  private toQueryResult(dto: QueryResultDto): QueryResult {
    return {
      ...dto,
      resultSets: dto.resultSets.map((set) => this.toResultSet(set, dto.durationMs)),
    };
  }

  private toResultSet(dto: ResultSetDto, durationMs: number): ResultSet {
    const columns = dto.columns.map<ResultColumn>((column) => {
      const kind = classify(column.dataType);

      return {
        name: column.name,
        dataType: column.dataType,
        kind,
        width: WIDTH_BY_KIND[kind],
      };
    });

    // La última columna se estira para ocupar el espacio sobrante, como en el
    // mockup.
    if (columns.length > 0) {
      columns[columns.length - 1] = { ...columns[columns.length - 1], width: null };
    }

    return {
      columns,
      rows: dto.rows.map((values, index) => ({ number: index + 1, values })),
      totalRows: dto.rows.length,
      durationMs,
      truncated: dto.truncated,
    };
  }
}

/**
 * Clasifica el tipo del motor en una de las familias que la cuadrícula sabe
 * pintar.
 *
 * Se hace por nombre de tipo y no por motor: `int8`, `bigint` y `INT64` son el
 * mismo concepto para quien mira la tabla. Lo que no encaje se trata como texto,
 * que siempre se puede mostrar.
 */
function classify(dataType: string): ResultColumn['kind'] {
  const type = dataType.toLowerCase();

  if (type.includes('bool')) {
    return 'boolean';
  }

  if (type.includes('uuid') || type.includes('uniqueidentifier')) {
    return 'uuid';
  }

  if (type.includes('timestamp') || type.includes('date') || type.includes('time')) {
    return 'timestamp';
  }

  if (type.includes('bytea') || type.includes('binary') || type.includes('blob')) {
    return 'binary';
  }

  const numeric = ['int', 'serial', 'numeric', 'decimal', 'real', 'double', 'float', 'money'];

  if (numeric.some((candidate) => type.includes(candidate))) {
    return 'number';
  }

  return 'text';
}

/**
 * Arma el formulario de una importación.
 *
 * `FormData` en lugar de JSON porque lleva un archivo dentro: el navegador pone
 * el `Content-Type` con su frontera y Angular no toca el cuerpo.
 */
function form(
  sessionId: string,
  table: DatabaseObject,
  file: File,
  options: ImportOptions,
): FormData {
  const data = new FormData();

  data.append('sessionId', sessionId);
  data.append('table', JSON.stringify(table));
  data.append('file', file, file.name);
  data.append('hasHeaders', String(options.hasHeaders));
  data.append('delimiter', options.delimiter);
  data.append('encoding', options.encoding);
  data.append('nullText', options.nullText);

  return data;
}
