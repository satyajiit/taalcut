// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TemplateStore.list's sorts (P3-V14) and their keyset cursors. Each sort orders by one value, then the larger id
 * (as @taalcut/templates' memory store does), so a page never repeats or skips a template. A template with no
 * trend date comes last whichever way the trend sort runs. No sort keeps Phase 2's order: the most recently
 * changed first. A cursor names the sort it was made for; another sort's cursor is refused.
 */
import {
  err,
  ok,
  ValidationError,
  type Result,
  type TemplateListQuery,
  type TemplateSort,
} from '@taalcut/core';
import { asc, desc, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { templates } from '../schema/templates';

type Dir = 'asc' | 'desc';
type CursorValue = string | number | null;

/** How many timelines use each template (any version): what the 'used' sort orders by. */
export const timelinesUsing = sql<number>`(SELECT count(*) FROM timelines tl WHERE tl.template_id = ${templates.id})`;

interface Sort {
  /** What the sort orders by (before the id). */
  readonly value: SQL | typeof templates.updatedAt | typeof templates.nameKey;
  readonly read: (row: SortRow) => CursorValue;
  /** Nulls sort last in both directions (only the trend date can be null). */
  readonly nullable?: boolean;
}

export interface SortRow {
  readonly updatedAt: number;
  /** stores/template-name-key.ts: the name sort's Unicode key (migration 24). */
  readonly nameKey: string;
  readonly trendDate: string | null;
  readonly favourite: boolean;
  readonly used: number;
}

const SORTS: Record<TemplateSort, Sort> = {
  updated: { value: templates.updatedAt, read: (row) => row.updatedAt },
  name: { value: templates.nameKey, read: (row) => row.nameKey },
  trend: { value: sql`${templates.trendDate}`, read: (row) => row.trendDate, nullable: true },
  favourite: { value: sql`${templates.favourite}`, read: (row) => (row.favourite ? 1 : 0) },
  used: { value: timelinesUsing, read: (row) => row.used },
};

export interface ListOrder {
  readonly sort: TemplateSort;
  readonly dir: Dir;
}

/** Absent sort: Phase 2's order, most recently changed first. */
export function listOrder(query: Pick<TemplateListQuery, 'sort' | 'dir'>): ListOrder {
  return query.sort ? { sort: query.sort, dir: query.dir ?? 'desc' } : { sort: 'updated', dir: 'desc' };
}

export function orderBy({ sort, dir }: ListOrder): SQL[] {
  const { value, nullable } = SORTS[sort];
  const by = dir === 'asc' ? asc(value) : desc(value);
  return [...(nullable ? [sql`(${value}) IS NULL`] : []), by, desc(templates.id)];
}

const cursorSchema = z.object({
  s: z.enum(['updated', 'name', 'trend', 'favourite', 'used']),
  v: z.union([z.string().max(200), z.number(), z.null()]),
  id: z.string().min(1).max(40),
});

export function encodeListCursor(order: ListOrder, row: SortRow & { readonly id: string }): string {
  const cursor = { s: order.sort, v: SORTS[order.sort].read(row), id: row.id };
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

/** The rows after the cursor's, in `order`. */
export function afterCursor(order: ListOrder, cursor: string): Result<SQL> {
  let decoded: unknown;
  try {
    decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    return err(ValidationError({ field: 'cursor' }));
  }
  const parsed = cursorSchema.safeParse(decoded);
  if (!parsed.success || parsed.data.s !== order.sort) return err(ValidationError({ field: 'cursor' }));
  const { v, id } = parsed.data;
  const { value, nullable } = SORTS[order.sort];
  const earlierId = sql`${templates.id} < ${id}`;
  if (v === null) {
    // Only a nullable sort writes a null; after it come the remaining nulls, by id.
    return nullable
      ? ok(sql`((${value}) IS NULL AND ${earlierId})`)
      : err(ValidationError({ field: 'cursor' }));
  }
  const beyond = order.dir === 'asc' ? sql`(${value}) > ${v}` : sql`(${value}) < ${v}`;
  const tied = sql`((${value}) = ${v} AND ${earlierId})`;
  return ok(nullable ? sql`(${beyond} OR ${tied} OR (${value}) IS NULL)` : sql`(${beyond} OR ${tied})`);
}
