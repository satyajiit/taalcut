// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The calls a usage summary counts (G8), as one SQL common table expression every aggregate reads. A call's
 * project is the one it names, else the project of the conversation its agent run belongs to (the model call
 * log records the run, not the project), the same rule as the project's budget spend (budget-store.ts).
 */
import type { UsageSummaryInput } from '@taalcut/core';
import type { SqlValue } from '../driver/types';

export interface SummaryScope {
  /** `WITH scoped AS (…)`: cloud-call rows with a `project` column, filtered. */
  readonly sql: string;
  readonly params: readonly SqlValue[];
}

/**
 * A call's project as SQL over the `cloud_calls` row named `table`: the one it names, else its agent run's
 * conversation's. The request log's project filter (repositories/usage.ts) reads the same rule.
 */
export const projectOfCall = (
  table: string,
) => `coalesce(${table}.project_id, (SELECT c.project_id FROM agent_runs r
  JOIN conversations c ON c.id = r.conversation_id WHERE r.run_id = ${table}.run_id))`;

export function summaryScope(input: UsageSummaryInput): SummaryScope {
  const where = ['cc.started_at >= ?', 'cc.started_at <= ?'];
  const params: SqlValue[] = [input.from, input.to];
  if (input.module !== undefined) {
    where.push('cc.module = ?');
    params.push(input.module);
  }
  if (input.provider !== undefined) {
    where.push('cc.provider = ?');
    params.push(input.provider);
  }
  const projectFilter = input.projectId === undefined ? '' : 'WHERE project = ?';
  if (input.projectId !== undefined) params.push(input.projectId);
  return {
    sql: `WITH scoped AS (
      SELECT * FROM (
        SELECT cc.module, cc.provider, cc.local, cc.started_at, cc.bytes_sent, cc.input_tokens, cc.output_tokens,
          cc.cached_input_tokens, cc.cost_micro_usd, cc.billed_unit, cc.billed_quantity,
          ${projectOfCall('cc')} AS project
        FROM cloud_calls cc WHERE ${where.join(' AND ')}
      ) ${projectFilter}
    )`,
    params,
  };
}
