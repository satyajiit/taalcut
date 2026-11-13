// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.traces, served by the agent process from the TraceStore port
 * (the library's trace tables, P1-G5). Developer-only: the renderer shows it
 * at /dev/traces.
 *
 * Spans are rebuilt from the run log: run (root) → step → model call and tool
 * call, with approval waits as child spans of the tool call they gate.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { ipc } from '../ipc/contract';
import { RUN_STATUSES } from '../ports/run-log';

export const SPAN_KINDS = ['run', 'step', 'model', 'tool', 'approval'] as const;
export type SpanKind = (typeof SPAN_KINDS)[number];

export const SPAN_STATUSES = ['ok', 'error', 'cancelled', 'running'] as const;
export type SpanStatus = (typeof SPAN_STATUSES)[number];

const count = z.int().nonnegative();

export const spanSchema = z.object({
  spanId: z.string().min(1).max(200),
  parentSpanId: z.string().min(1).max(200).nullable(),
  kind: z.enum(SPAN_KINDS),
  /**
   * run: the user's request; step: the plan step's text (model-written, plain
   * text); model: 'provider/model'; tool: the tool name; approval: the reason.
   */
  name: z.string(),
  /** Epoch ms. */
  startedAt: count,
  /** Absent while the span is still open. */
  endedAt: count.optional(),
  status: z.enum(SPAN_STATUSES),
  /** Model calls. */
  provider: z.string().optional(),
  model: z.string().optional(),
  stopReason: z.enum(['end', 'tool_calls', 'max_tokens']).optional(),
  /** Model and tool calls. */
  inputTokens: count.optional(),
  outputTokens: count.optional(),
  cachedInputTokens: count.optional(),
  costUsd: z.number().nonnegative().optional(),
  /** Tool calls. */
  tool: z.string().optional(),
  version: z.string().optional(),
  sideEffect: z.enum(['read', 'write', 'destructive', 'external']).optional(),
  attempts: z.int().positive().optional(),
  cacheHit: z.boolean().optional(),
  deduplicated: z.boolean().optional(),
  errorCode: z.string().optional(),
  /** Point-in-time events: retries, fallbacks. */
  events: z.array(
    z.object({ name: z.enum(['retry', 'fallback']), at: count, detail: z.string().optional() }),
  ),
});
export type Span = z.infer<typeof spanSchema>;
/** The library's name for a span. */
export const traceSpanSchema = spanSchema;
export type TraceSpan = Span;

/** The agent's completeness check (P1-G5): what a finished run is missing. */
export const traceGapSchema = z.object({
  spanId: z.string().optional(),
  /** Run-log seq of the event that has no outcome or is missing a number. */
  seq: z.int().positive(),
  reason: z.enum(['no-outcome', 'no-tokens', 'no-cost', 'no-latency']),
});
export type TraceGap = z.infer<typeof traceGapSchema>;

/** A run's header: recorded when it starts, and again when its status changes or it ends. */
export const traceRunSchema = z.object({
  runId: idSchema<'AgentRun'>(),
  conversationId: idSchema<'Conversation'>().nullable(),
  status: z.enum(RUN_STATUSES),
  /** The user's request (plain text). */
  message: z.string(),
  startedAt: count,
  endedAt: count.optional(),
  gaps: z.array(traceGapSchema).optional(),
});
export type TraceRunInput = z.infer<typeof traceRunSchema>;

export const traceSchema = z.object({
  runId: idSchema<'AgentRun'>(),
  conversationId: idSchema<'Conversation'>().nullable(),
  status: z.enum(RUN_STATUSES),
  /** The user's request (plain text). */
  message: z.string(),
  startedAt: count,
  endedAt: count.optional(),
  /** Depth-first, parents before children, siblings by start time. */
  spans: z.array(spanSchema),
  gaps: z.array(traceGapSchema),
});
export type Trace = z.infer<typeof traceSchema>;

export const traceSummarySchema = traceSchema
  .pick({ runId: true, conversationId: true, status: true, message: true, startedAt: true, endedAt: true })
  .extend({
    modelCalls: count,
    toolCalls: count,
    tokens: count,
    costUsd: z.number().nonnegative(),
    cacheHits: count,
    complete: z.boolean(),
  });
export type TraceSummary = z.infer<typeof traceSummarySchema>;

export const tracesContract = {
  /** Newest first. */
  runs: ipc
    .input(z.object({ limit: z.int().min(1).max(200).default(50) }))
    .output(z.array(traceSummarySchema)),
  /** Unknown run: core.not_found. */
  get: ipc.input(z.object({ runId: idSchema<'AgentRun'>() })).output(traceSchema),
};
