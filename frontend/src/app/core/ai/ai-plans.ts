import { AiExecutionPlan, AiPlanAttachment, AiSource } from '../../shared/models/ai';
import { EngineCapabilities, ResultSet } from '../../shared/models/workspace';

/** Reconoce solo la tabla cruda conocida; el texto de los operadores queda intacto. */
export function sqlitePlan(
  capabilities: EngineCapabilities | undefined,
  source: AiSource,
  sql: string,
  executionId: string,
  occurredAtUtc: string,
  sets: readonly ResultSet[],
): AiPlanAttachment | null {
  if (
    capabilities?.aiPlanFormat !== 'sqlite-query-plan' ||
    !/^\s*EXPLAIN\s+QUERY\s+PLAN\s+\S/i.test(sql) ||
    sets.length !== 1
  )
    return null;
  const set = sets[0];
  if (
    set.truncated ||
    set.rows.length === 0 ||
    set.rows.length > 200 ||
    set.columns.map((column) => column.name.toLowerCase()).join(',') !==
      'id,parent,notused,detail' ||
    set.rows.some(
      (row) =>
        row.values.length !== 4 ||
        !row.values.slice(0, 3).every((value) => value !== null && /^\d+$/.test(value)) ||
        row.values[3] === null,
    )
  )
    return null;
  const plan: AiExecutionPlan = {
    format: 'sqlite-query-plan',
    executionId,
    occurredAtUtc,
    sql,
    text: ['id\tparent\tnotused\tdetail', ...set.rows.map((row) => row.values.join('\t'))].join(
      '\n',
    ),
  };
  return { source: { ...source }, plan };
}
