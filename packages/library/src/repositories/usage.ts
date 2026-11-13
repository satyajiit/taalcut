// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings → Usage: pages of the cloud-call log, newest first, with totals.
 * Keyset paging on `started_at` (indexed, alone and with `module`): a page
 * never splits calls that started in the same millisecond, so `nextBefore`
 * (the last row's start time) can't skip or repeat a call. The dashboard's
 * filters (round P3-3: period start, module, provider, project) apply in SQL,
 * so `totals` cover exactly the rows the pages hold; a call's project is the
 * summary's rule (usage/summary-scope.ts).
 */
import {
  err,
  ok,
  usageListInputSchema,
  ValidationError,
  type Result,
  type UsageListInput,
} from '@taalcut/core';
import { and, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { cloudCalls } from '../schema/settings';
import type { UsagePage, UsageTotals } from '../traces/types';
import { projectOfCall } from '../usage/summary-scope';
import { toCloudCallRecord } from './models';

/** Core's request-log input: `limit` 1..500 (default 100; a page can run past it to keep same-millisecond calls together). */
export type UsageQuery = UsageListInput;

export interface UsageRepository {
  list(query?: UsageQuery): Result<UsagePage>;
}

/** The WHERE clause for a parsed input, or a validation error naming the field. */
function filterOf(query: UsageQuery) {
  const parsed = usageListInputSchema.safeParse(query);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path.map(String).join('.') || undefined;
    return err(ValidationError(field ? { field } : undefined, { detail: parsed.error.message }));
  }
  const { limit, before, from, module, provider, projectId } = parsed.data;
  const where = and(
    module ? eq(cloudCalls.module, module) : undefined,
    provider ? eq(cloudCalls.provider, provider) : undefined,
    from !== undefined ? gte(cloudCalls.startedAt, from) : undefined,
    before !== undefined ? lt(cloudCalls.startedAt, before) : undefined,
    projectId ? sql`${sql.raw(projectOfCall('"cloud_calls"'))} = ${projectId}` : undefined,
  );
  return ok({ limit, where });
}

export function createUsageRepository(db: LibraryDatabase): UsageRepository {
  const { orm } = db;
  return {
    list(query = {}) {
      const parsed = filterOf(query);
      if (!parsed.ok) return parsed;
      const { limit, where: filter } = parsed.value;
      const newest = desc(cloudCalls.startedAt);
      let rows = orm
        .select()
        .from(cloudCalls)
        .where(filter)
        .orderBy(newest, desc(cloudCalls.id))
        .limit(limit + 1)
        .all();
      const more = rows.length > limit;
      if (more) {
        // Take every call from the boundary millisecond, so the next page can start strictly before it.
        const boundary = rows[limit - 1]!.startedAt;
        rows = orm
          .select()
          .from(cloudCalls)
          .where(and(filter, gte(cloudCalls.startedAt, boundary)))
          .orderBy(newest, desc(cloudCalls.id))
          .all();
      }
      const sums = orm
        .select({
          calls: sql<number>`count(*)`,
          localCalls: sql<number>`coalesce(sum(${cloudCalls.local}), 0)`,
          inputTokens: sql<number>`coalesce(sum(${cloudCalls.inputTokens}), 0)`,
          outputTokens: sql<number>`coalesce(sum(${cloudCalls.outputTokens}), 0)`,
          cachedInputTokens: sql<number>`coalesce(sum(${cloudCalls.cachedInputTokens}), 0)`,
          costMicroUsd: sql<number>`coalesce(sum(${cloudCalls.costMicroUsd}), 0)`,
        })
        .from(cloudCalls)
        .where(filter)
        .get()!;
      const { costMicroUsd, ...counts } = sums;
      const totals: UsageTotals = { ...counts, costUsd: costMicroUsd / 1_000_000 };
      const records = rows.map(toCloudCallRecord);
      const last = records.at(-1);
      // More rows than the boundary millisecond held: there is another page.
      const another = more && last !== undefined && totals.calls > records.length;
      return ok({ records, totals, ...(another ? { nextBefore: last.startedAt } : {}) });
    },
  };
}
