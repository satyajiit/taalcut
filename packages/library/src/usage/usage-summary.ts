// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UsageStore.summary (G8): Settings › Usage's dashboard, aggregated in SQL over the cloud-call log. Totals, every
 * local day of the period (in the request's time zone, day-buckets.ts) with its spend by module, and spend by
 * module, provider and project (with the project's cap), each biggest first. Group token counts include cached
 * input; the totals keep it apart. `units` sums what non-token APIs billed (characters, seconds, images, credits).
 */
import {
  err,
  MODEL_MODULE_IDS,
  ok,
  parseId,
  usageSummaryInputSchema,
  ValidationError,
  type ModelModuleId,
  type Result,
  type UsageSummary,
} from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import type { SqlRow } from '../driver/types';
import { dayBuckets, type DayBucket } from './day-buckets';
import { summaryScope, type SummaryScope } from './summary-scope';

type Units = UsageSummary['totals']['units'];
type Group = { calls: number; inputTokens: number; outputTokens: number; costUsd: number; units: Units };

const MAX_PROVIDERS = 100;
const MAX_PROJECTS = 500;
const dollars = (micros: unknown) => Number(micros ?? 0) / 1_000_000;
const count = (value: unknown) => Number(value ?? 0);
const isModule = (value: unknown): value is ModelModuleId =>
  typeof value === 'string' && (MODEL_MODULE_IDS as readonly string[]).includes(value);

/** Billed quantities other than tokens, per group key ('' for the totals). */
function unitsBy(db: LibraryDatabase, scope: SummaryScope, key: string): Map<unknown, Units> {
  const rows = db.driver
    .prepare(
      `${scope.sql} SELECT ${key} AS key, billed_unit AS unit, sum(billed_quantity) AS quantity FROM scoped
       WHERE billed_unit IS NOT NULL AND billed_unit <> 'token' GROUP BY 1, 2`,
    )
    .all(...scope.params);
  const units = new Map<unknown, Units>();
  for (const row of rows) {
    const into: Record<string, number> = { ...units.get(row.key) };
    into[String(row.unit)] = Number(row.quantity ?? 0);
    units.set(row.key, into);
  }
  return units;
}

/** Calls, tokens and spend per `key`, biggest spend first (then most calls). */
function groups(db: LibraryDatabase, scope: SummaryScope, key: string, limit: number, extra = ''): SqlRow[] {
  return db.driver
    .prepare(
      `${scope.sql} SELECT ${key} AS key, count(*) AS calls, sum(input_tokens + cached_input_tokens) AS input,
         sum(output_tokens) AS output, sum(cost_micro_usd) AS cost, max(local) AS local ${extra}
       FROM scoped s GROUP BY 1 ORDER BY cost DESC, calls DESC, key LIMIT ?`,
    )
    .all(...scope.params, limit);
}

function groupOf(row: SqlRow, units: Map<unknown, Units>): Group {
  return {
    calls: count(row.calls),
    inputTokens: count(row.input),
    outputTokens: count(row.output),
    costUsd: dollars(row.cost),
    units: units.get(row.key) ?? {},
  };
}

function totalsOf(db: LibraryDatabase, scope: SummaryScope): UsageSummary['totals'] {
  const row = db.driver
    .prepare(
      `${scope.sql} SELECT count(*) AS calls, sum(local) AS local, sum(input_tokens) AS input,
         sum(output_tokens) AS output, sum(cached_input_tokens) AS cached, sum(cost_micro_usd) AS cost,
         sum(bytes_sent) AS sent FROM scoped`,
    )
    .get(...scope.params);
  return {
    calls: count(row?.calls),
    localCalls: count(row?.local),
    inputTokens: count(row?.input),
    outputTokens: count(row?.output),
    cachedInputTokens: count(row?.cached),
    costUsd: dollars(row?.cost),
    bytesSent: count(row?.sent),
    units: unitsBy(db, scope, "''").get('') ?? {},
  };
}

function byDay(db: LibraryDatabase, scope: SummaryScope, days: readonly DayBucket[]): UsageSummary['byDay'] {
  const rows = db.driver
    .prepare(
      `${scope.sql}, bounds AS (
         SELECT json_extract(value, '$[0]') AS day, json_extract(value, '$[1]') AS start,
           json_extract(value, '$[2]') AS end FROM json_each(?))
       SELECT b.day AS day, s.module AS module, count(*) AS calls, sum(s.cost_micro_usd) AS cost
       FROM scoped s JOIN bounds b ON s.started_at >= b.start AND s.started_at < b.end GROUP BY 1, 2`,
    )
    .all(...scope.params, JSON.stringify(days.map((d) => [d.day, d.start, d.end])));
  const out = new Map(
    days.map((d) => [d.day, { day: d.day, costUsd: 0, calls: 0, byModule: {} as Record<string, number> }]),
  );
  for (const row of rows) {
    const day = out.get(String(row.day));
    if (!day) continue;
    day.calls += count(row.calls);
    day.costUsd += dollars(row.cost);
    if (isModule(row.module)) day.byModule[row.module] = (day.byModule[row.module] ?? 0) + dollars(row.cost);
  }
  return [...out.values()];
}

function byProject(db: LibraryDatabase, scope: SummaryScope): UsageSummary['byProject'] {
  const units = unitsBy(db, scope, 'project');
  const extra = `, (SELECT budget_cap_micros FROM projects p WHERE p.id = s.project) AS cap_micros,
    (SELECT budget_cap_currency FROM projects p WHERE p.id = s.project) AS cap_currency`;
  return groups(db, scope, 'project', MAX_PROJECTS, extra).flatMap((row) => {
    const projectId = row.key === null ? ok(null) : parseId<'Project'>(row.key);
    if (!projectId.ok) return [];
    const cap =
      typeof row.cap_micros === 'number' && typeof row.cap_currency === 'string'
        ? { currency: row.cap_currency, micros: row.cap_micros }
        : null;
    return [{ projectId: projectId.value, cap, ...groupOf(row, units) }];
  });
}

/** The dashboard for one period and filter; `core.validation` for a bad range or time zone. */
export function summarizeUsage(db: LibraryDatabase, raw: unknown): Result<UsageSummary> {
  const parsed = usageSummaryInputSchema.safeParse(raw);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.map(String).join('.') || undefined;
    return err(ValidationError(field ? { field } : undefined, { detail: parsed.error.message }));
  }
  const input = parsed.data;
  const days = dayBuckets(input.from, input.to, input.timeZone);
  if (!days.ok) return days;
  const scope = summaryScope(input);
  const moduleUnits = unitsBy(db, scope, 'module');
  const providerUnits = unitsBy(db, scope, 'provider');
  return ok({
    from: input.from,
    to: input.to,
    totals: totalsOf(db, scope),
    byDay: byDay(db, scope, days.value),
    byModule: groups(db, scope, 'module', MODEL_MODULE_IDS.length * 4).flatMap((row) =>
      isModule(row.key) ? [{ module: row.key, ...groupOf(row, moduleUnits) }] : [],
    ),
    byProvider: groups(db, scope, 'provider', MAX_PROVIDERS).flatMap((row) =>
      typeof row.key === 'string' && row.key.length > 0
        ? [{ provider: row.key, local: count(row.local) > 0, ...groupOf(row, providerUnits) }]
        : [],
    ),
    byProject: byProject(db, scope),
  });
}
