import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';

import {
  DatabaseColumn,
  DatabaseObject,
  EngineInfo,
  QueryResult,
  ResultColumn,
  ResultSet,
  SessionInfo,
  TestConnectionResult,
} from '../../shared/models/workspace';
import {
  ApplicationGateway,
  ConnectRequest,
  ExecuteQueryRequest,
  HealthStatus,
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

  override executeQuery(request: ExecuteQueryRequest): Observable<QueryResult> {
    return this._http
      .post<QueryResultDto>('/api/queries', request)
      .pipe(map((dto) => this.toQueryResult(dto)));
  }

  override cancelQuery(executionId: string): Observable<void> {
    return this._http.delete<void>(`/api/queries/${executionId}`);
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
