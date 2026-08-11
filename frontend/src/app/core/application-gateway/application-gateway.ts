import { Observable } from 'rxjs';

/**
 * Estado del proceso local que atiende las peticiones de la aplicación.
 */
export interface HealthStatus {
  readonly status: string;
  readonly product: string;
  readonly version: string;
  readonly environment: string;
  readonly timestampUtc: string;
}

/**
 * Único punto de contacto entre la interfaz y la aplicación local.
 *
 * Los componentes dependen siempre de esta abstracción, nunca de HttpClient.
 * Hoy la implementa `HttpApplicationGateway`; cuando Tauri administre el proceso
 * (Fase 7) podrá sustituirse por una implementación IPC sin tocar la interfaz.
 *
 * Ver PLAN_TRABAJO_DRUSE.md §2 (Arquitectura) y §5 (Límites de los módulos).
 */
export abstract class ApplicationGateway {
  /** Verifica que el proceso local está activo. */
  abstract getHealth(): Observable<HealthStatus>;
}
