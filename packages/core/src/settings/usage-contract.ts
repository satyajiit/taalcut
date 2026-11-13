// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.usage (Settings → Usage), served by the agent process from the
 * library's CloudCall table (P1-F5) through the UsageStore port. Rows are
 * CloudCallRecord: sizes and counts only, never prompts or keys. G8 adds the
 * dashboard's summary and the limits a run meets (usage-summary.ts).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { eventIterator, ipc } from '../ipc/contract';
import { cloudCallRecordSchema } from '../ports/model-ports';
import { moduleIdSchema } from './models-contract';
import {
  usageLimitsSchema,
  usageSummaryInputSchema,
  usageSummarySchema,
  usageTotalsSchema,
} from './usage-summary';

export { usageTotalsSchema, type UsageTotals } from './usage-summary';

export const usagePageSchema = z.object({
  /** Newest first. */
  records: z.array(cloudCallRecordSchema),
  /** Over every row that matches the filter, not just this page. */
  totals: usageTotalsSchema,
  /** Pass as `before` for the next page; absent on the last page. */
  nextBefore: z.int().nonnegative().optional(),
});
export type UsagePage = z.infer<typeof usagePageSchema>;

/**
 * The request log's page and filter. Round P3-3: the dashboard's filters (G8), so "Every request" shows the
 * same rows as the summary instead of filtering each page in the window. `totals` cover every matching row.
 */
export const usageListInputSchema = z
  .object({
    limit: z.int().min(1).max(500).default(100),
    /** Rows that started before this epoch ms (the page cursor, or the period's end on the first page). */
    before: z.int().nonnegative().optional(),
    /** Rows that started at or after this epoch ms (the dashboard period's start). */
    from: z.int().nonnegative().optional(),
    module: moduleIdSchema.optional(),
    provider: z.string().min(1).max(100).optional(),
    projectId: idSchema<'Project'>().optional(),
  })
  .refine((input) => input.from === undefined || input.before === undefined || input.from < input.before, {
    message: 'from is not before before',
    path: ['before'],
  });
export type UsageListInput = z.input<typeof usageListInputSchema>;

export const usageContract = {
  list: ipc.input(usageListInputSchema).output(usagePageSchema),
  /** G8: the dashboard over a time range. */
  summary: ipc.input(usageSummaryInputSchema).output(usageSummarySchema),
  limits: ipc.output(usageLimitsSchema),
  /** The current limits first, then every change. */
  limitsChanged: ipc.output(eventIterator(usageLimitsSchema)),
};
