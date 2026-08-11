/**
 * Datos simulados de la Fase 1.
 *
 * Reproducen exactamente el contenido del mockup para poder comparar la pantalla
 * con el diseño. En la Fase 2 los sustituye el ApplicationGateway y este archivo
 * se borra: ningún componente debe importarlo fuera de su propia plantilla.
 */
import {
  ConnectionSummary,
  ExplorerNode,
  QueryTab,
  ResultSet,
  SessionStatus,
} from '../models/workspace';

export const MOCK_CONNECTIONS: readonly ConnectionSummary[] = [
  {
    id: 'ms-prod',
    name: 'SQL Server — Producción',
    engine: 'sqlserver',
    state: 'connected',
    expanded: false,
  },
  {
    id: 'pg-r3safety',
    name: 'PostgreSQL — R3Safety',
    engine: 'postgresql',
    state: 'connected',
    expanded: true,
  },
  {
    id: 'my-dev',
    name: 'MySQL — Desarrollo',
    engine: 'mysql',
    state: 'disconnected',
    expanded: false,
  },
];

/** Contenido desplegado bajo la conexión PostgreSQL activa. */
export const MOCK_EXPLORER_NODES: readonly ExplorerNode[] = [
  { id: 'databases', label: 'Databases', kind: 'folder', depth: 1, expandable: true, expanded: true, badge: '4' },
  { id: 'db-r3safety', label: 'r3safety', kind: 'database', depth: 2, expandable: true, expanded: true, selected: true },
  { id: 'schemas', label: 'Schemas', kind: 'folder', depth: 3, expandable: true, expanded: true, hint: '/ public' },
  { id: 'tables', label: 'Tables', kind: 'folder', depth: 4, expandable: true, expanded: true, badge: '18' },
  { id: 't-users', label: 'users', kind: 'table', depth: 5, expandable: false, badge: '1 284', selected: true },
  { id: 't-tenants', label: 'tenants', kind: 'table', depth: 5, expandable: false, badge: '37' },
  { id: 't-empresa', label: 'empresa', kind: 'table', depth: 5, expandable: false, badge: '412' },
  { id: 't-documentos', label: 'documentos', kind: 'table', depth: 5, expandable: false, badge: '9 630' },
  { id: 'views', label: 'Views', kind: 'folder', depth: 4, expandable: true, expanded: false, badge: '6' },
  { id: 'functions', label: 'Functions', kind: 'folder', depth: 4, expandable: true, expanded: false, badge: '11' },
  { id: 'procedures', label: 'Procedures', kind: 'folder', depth: 4, expandable: true, expanded: false, badge: '3' },
];

export const MOCK_TABS: readonly QueryTab[] = [
  { id: 'q1', title: 'Query 1', active: true, dirty: true },
  { id: 'q2', title: 'usuarios.sql', active: false, dirty: false },
  { id: 'q3', title: 'empresa.sql', active: false, dirty: false },
];

export const MOCK_SQL = `SELECT
  u.id,
  u.name,
  u.email,
  u.created_at
FROM users u
WHERE u.is_active = true
ORDER BY u.created_at DESC;
-- filtra usuarios activos del tenant actual
`;

export const MOCK_RESULT_SET: ResultSet = {
  durationMs: 124,
  totalRows: 1284,
  columns: [
    { name: 'id', dataType: 'int8', kind: 'number', width: 84, sorted: 'desc', filter: '> 0' },
    { name: 'name', dataType: 'text', kind: 'text', width: 210 },
    { name: 'email', dataType: 'text', kind: 'text', width: 300, filter: '%@r3safety.io' },
    { name: 'is_active', dataType: 'bool', kind: 'boolean', width: 118, filter: 'true' },
    { name: 'created_at', dataType: 'timestamptz', kind: 'timestamp', width: null },
  ],
  rows: [
    {
      number: 1,
      values: ['1042', 'María Fernanda Ruiz', 'mfruiz@r3safety.io', 'true', '2026-07-28 09:14:02'],
    },
    {
      number: 2,
      values: ['1041', 'Diego Alonso Paredes', 'dparedes@r3safety.io', 'true', '2026-07-27 17:42:55'],
    },
    {
      number: 3,
      values: ['1038', 'Carla Benítez', 'cbenitez@r3safety.io', 'true', '2026-07-26 11:08:31'],
    },
    {
      number: 4,
      values: ['1035', 'Andrés Villalba', 'avillalba@r3safety.io', 'true', '2026-07-25 08:55:17'],
    },
    // Fila con un nulo a propósito: los nulos deben verse distintos de la cadena
    // vacía en cuanto exista la cuadrícula real (plan §6).
    {
      number: 5,
      values: ['1030', 'Lucía Gómez', null, 'true', '2026-07-24 20:31:44'],
    },
  ],
};

export const MOCK_SESSION: SessionStatus = {
  connected: true,
  engine: 'postgresql',
  engineVersion: 'PostgreSQL 18',
  database: 'r3safety',
  user: 'app_admin@10.0.2.14',
  lastDurationMs: 124,
};
