// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Settings › Usage's dashboard and the limits a run meets (G8): spend by day, module, provider and project, with
 * the non-token units providers bill (characters, seconds, images, credits), and the rate, quota and plan limits
 * the models client is waiting on. The library aggregates the summary in SQL over the cloud-call rows; limits
 * are the models client's in-memory state behind the UsageLimits port.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { moneySchema } from '../basics/money';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { BILLED_UNITS, MODEL_MODULE_IDS } from '../ports/model-ports';
import { moduleIdSchema } from './models-contract';

const count = z.int().nonnegative();

export const usageTotalsSchema = z.object({
  calls: count,
  /** Calls that never left this Mac. */
  localCalls: count,
  inputTokens: count,
  outputTokens: count,
  cachedInputTokens: count,
  costUsd: z.number().nonnegative(),
});
export type UsageTotals = z.infer<typeof usageTotalsSchema>;
/** Billed quantities that aren't tokens, by unit. */
export const billedUnitsSchema = z.partialRecord(z.enum(BILLED_UNITS), z.number().nonnegative());

const groupRow = {
  calls: count,
  inputTokens: count,
  outputTokens: count,
  costUsd: z.number().nonnegative(),
  units: billedUnitsSchema,
};

export const usageSummaryInputSchema = z
  .object({
    from: z.int().nonnegative(),
    to: z.int().nonnegative(),
    /** IANA zone the days are counted in. */
    timeZone: z.string().min(1).max(64),
    module: moduleIdSchema.optional(),
    provider: z.string().min(1).max(100).optional(),
    projectId: idSchema<'Project'>().optional(),
  })
  .refine((input) => input.from <= input.to, { message: 'from is after to', path: ['to'] });
export type UsageSummaryInput = z.output<typeof usageSummaryInputSchema>;

export const usageSummarySchema = z.object({
  from: z.int().nonnegative(),
  to: z.int().nonnegative(),
  totals: usageTotalsSchema.extend({ bytesSent: count, units: billedUnitsSchema }),
  byDay: z
    .array(
      z.object({
        /** Local date in the request's time zone. */
        day: z.iso.date(),
        costUsd: z.number().nonnegative(),
        calls: count,
        byModule: z.partialRecord(z.enum(MODEL_MODULE_IDS), z.number().nonnegative()),
      }),
    )
    .max(400),
  byModule: z.array(z.object({ module: moduleIdSchema, ...groupRow })).max(MODEL_MODULE_IDS.length),
  byProvider: z.array(z.object({ provider: z.string().min(1), local: z.boolean(), ...groupRow })).max(100),
  byProject: z
    .array(
      z.object({ projectId: idSchema<'Project'>().nullable(), cap: moneySchema.nullable(), ...groupRow }),
    )
    .max(500),
});
export type UsageSummary = z.output<typeof usageSummarySchema>;

export const USAGE_LIMIT_KINDS = ['rate', 'quota', 'plan'] as const;
export type UsageLimitKind = (typeof USAGE_LIMIT_KINDS)[number];
export const USAGE_LIMIT_WAITERS = ['run', 'background', 'export'] as const;

export const usageLimitSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1).optional(),
  modules: z.array(moduleIdSchema).max(MODEL_MODULE_IDS.length),
  kind: z.enum(USAGE_LIMIT_KINDS),
  since: z.int().nonnegative(),
  /** From Retry-After or the provider's reset; null: unknown (retrying with backoff). */
  resetsAt: z.int().nonnegative().nullable(),
  /** What is waiting on it right now. */
  waiting: z.array(z.enum(USAGE_LIMIT_WAITERS)).max(USAGE_LIMIT_WAITERS.length),
  /** The provider's billing page, for a quota. */
  billingUrl: z.url({ protocol: /^https$/ }).optional(),
});
export type UsageLimit = z.output<typeof usageLimitSchema>;
export const usageLimitsSchema = z.array(usageLimitSchema).max(64);

/** The limits the models client is tracking (models implements it in the agent process). */
export interface UsageLimits {
  current(): readonly UsageLimit[];
  /** Every change; returns an unsubscribe function. */
  subscribe(listener: (limits: readonly UsageLimit[]) => void): () => void;
}
export const UsageLimitsToken = createToken<UsageLimits>('core.usageLimits');

/** UsageStore's summary (the library aggregates it in SQL). */
export type UsageSummarize = (input: UsageSummaryInput) => AsyncResult<UsageSummary>;
