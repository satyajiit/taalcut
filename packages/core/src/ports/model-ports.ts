// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Persistence ports that @taalcut/models writes through and
 * @taalcut/library implements. They live in core because library may import
 * only core. The record shape matches what models' ModelClient produces.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type CloudCallId, type ProjectId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';

/** The modules that each get their own model (PRD 8, R27). Same values as models' MODULE_IDS. */
export const MODEL_MODULE_IDS = [
  'agent',
  'router',
  'vision',
  'embeddings',
  'speech',
  'voice',
  'music',
  'images',
] as const;
export type ModelModuleId = (typeof MODEL_MODULE_IDS)[number];

/** Same values as models' REASONING_LEVELS. */
export const REASONING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
export type ReasoningLevel = (typeof REASONING_LEVELS)[number];

export const CLOUD_CALL_OUTCOMES = ['ok', 'error', 'cancelled'] as const;
/** What a non-token API bills by (P3: speech characters or credits, seconds of music, images). */
export const BILLED_UNITS = ['token', 'character', 'second', 'image', 'credit'] as const;
export type BilledUnit = (typeof BILLED_UNITS)[number];
export const billedSchema = z.object({ unit: z.enum(BILLED_UNITS), quantity: z.number().nonnegative() });
export type Billed = z.output<typeof billedSchema>;
export type CloudCallOutcome = (typeof CLOUD_CALL_OUTCOMES)[number];

/**
 * One row per outbound model request (G9, P1-F5). Sizes and counts only:
 * never prompts, outputs, keys or tokens.
 */
export interface CloudCallRecord {
  readonly id: CloudCallId;
  readonly module: ModelModuleId;
  readonly provider: string;
  readonly model: string;
  readonly reasoning: ReasoningLevel;
  /** True when the endpoint is on this machine; such calls send nothing off the device. */
  readonly local: boolean;
  /** Epoch ms when the request started. */
  readonly startedAt: number;
  readonly latencyMs: number;
  /** Request body bytes put on the wire. */
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedInputTokens: number;
  readonly cacheWriteTokens: number;
  readonly costUsd: number;
  /** Subscription calls consume plan allowance; costUsd records only separate API spend. */
  readonly billing?: 'apiKey' | 'subscription';
  readonly outcome: CloudCallOutcome;
  /** TaalcutError code when outcome isn't 'ok'. */
  readonly errorCode?: string;
  readonly httpStatus?: number;
  /** 1 for the primary model, 2+ when the fallback chain moved on. */
  readonly attempt: number;
  readonly runId?: string;
  readonly spanId?: string;
  /** The project the call worked for, when the caller knows it: budgets count spend per project. */
  readonly projectId?: ProjectId;
  /** What the provider billed, for non-token APIs. Absent: tokens. */
  readonly billed?: Billed;
}

const count = z.int().nonnegative();

export const cloudCallRecordSchema: z.ZodType<CloudCallRecord> = z.object({
  id: idSchema<'CloudCall'>(),
  module: z.enum(MODEL_MODULE_IDS),
  provider: z.string().min(1),
  model: z.string().min(1),
  reasoning: z.enum(REASONING_LEVELS),
  local: z.boolean(),
  startedAt: count,
  latencyMs: z.number().nonnegative(),
  bytesSent: count,
  bytesReceived: count,
  inputTokens: count,
  outputTokens: count,
  cachedInputTokens: count,
  cacheWriteTokens: count,
  costUsd: z.number().nonnegative(),
  billing: z.enum(['apiKey', 'subscription']).optional(),
  outcome: z.enum(CLOUD_CALL_OUTCOMES),
  errorCode: z.string().optional(),
  httpStatus: z.int().optional(),
  attempt: z.int().positive(),
  runId: z.string().optional(),
  spanId: z.string().optional(),
  projectId: idSchema<'Project'>().optional(),
  billed: billedSchema.optional(),
});

/** Where CloudCall rows go. A failing sink never fails the model call: callers log the Err and move on. */
export interface CloudCallSink {
  record(record: CloudCallRecord): AsyncResult<void>;
}

export const CloudCallSinkToken = createToken<CloudCallSink>('core.cloudCallSink');

/**
 * Where model-profile state is kept (ModelProfile, PRD 6.3). models owns the
 * schema and validates what `load` returns; library stores it as opaque JSON.
 */
export interface ModelProfileStore {
  /** The saved state as stored, or undefined on first run. Unvalidated. */
  load(): AsyncResult<unknown>;
  /** A models command passes its `context`: the document then commits with the command's audit row. */
  save(state: unknown, context?: CommandContext): AsyncResult<void>;
}

export const ModelProfileStoreToken = createToken<ModelProfileStore>('core.modelProfileStore');
