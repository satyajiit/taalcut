// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Persisted agent traces (P1-G5) for the developer trace viewer. The agent
 * records a run's header and each span as it opens and closes; the viewer
 * lists runs with totals and reads one run's span tree. Run messages, span
 * names and attributes are redacted of secrets; only the newest `maxRuns`
 * runs are kept.
 */
import { err, NotFoundError, ok, ValidationError, type Result, type RunId } from '@taalcut/core';
import { asc, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { traceRuns, traceSpans } from '../schema/traces';
import { redactSecrets, redactText } from '../secrets/redact';
import {
  traceRunSchema,
  traceSpanSchema,
  type Trace,
  type TraceGap,
  type TraceRunInput,
  type TraceSpan,
  type TraceSummary,
} from '../traces/types';
import { inTransaction, pageSize } from './shared';

export interface TraceRepository {
  /** Creates or updates a run's header: status, end, gaps. The first record of a run sets its start. */
  recordRun(run: TraceRunInput): Result<void>;
  /** Creates or replaces a span (an open span is recorded again when it ends). An unknown run is created, running. */
  recordSpan(runId: RunId, span: TraceSpan): Result<void>;
  /** Newest first, with totals over each run's model and tool spans. Default 50, at most 200. */
  runs(options?: { limit?: number }): TraceSummary[];
  /** One run with its spans depth-first. Unknown or expired runs are core.not_found. */
  get(runId: RunId): Result<Trace>;
}

export const DEFAULT_TRACE_RUNS_KEPT = 500;

type SpanRow = typeof traceSpans.$inferSelect;

function invalid(field: string, error: z.ZodError) {
  const path = error.issues[0]?.path.map(String).join('.');
  return err(ValidationError({ field: path ? `${field}.${path}` : field }, { detail: error.message }));
}

const defined = <T extends object>(value: T) =>
  Object.fromEntries(Object.entries(value).filter(([, v]) => v !== null && v !== undefined));

function toSpan(row: SpanRow): TraceSpan {
  const attributes = row.attributes as Partial<TraceSpan>;
  return {
    spanId: row.spanId,
    parentSpanId: row.parentSpanId,
    kind: row.kind,
    name: row.name,
    startedAt: row.startedAt,
    ...defined({
      endedAt: row.endedAt,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cachedInputTokens: row.cachedInputTokens,
      costUsd: row.costUsd,
      cacheHit: row.cacheHit,
    }),
    status: row.status,
    ...attributes,
    events: attributes.events ?? [],
  };
}

/** Parents before children, siblings by start time; spans whose parent is missing count as roots. */
function depthFirst(spans: readonly TraceSpan[]): TraceSpan[] {
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map<string | null, TraceSpan[]>();
  for (const span of spans) {
    const parent = span.parentSpanId !== null && ids.has(span.parentSpanId) ? span.parentSpanId : null;
    children.set(parent, [...(children.get(parent) ?? []), span]);
  }
  const ordered: TraceSpan[] = [];
  const visit = (parent: string | null) => {
    const siblings = (children.get(parent) ?? []).sort(
      (a, b) => a.startedAt - b.startedAt || a.spanId.localeCompare(b.spanId),
    );
    for (const span of siblings) {
      ordered.push(span);
      visit(span.spanId);
    }
  };
  visit(null);
  return ordered;
}

export function createTraceRepository(
  db: LibraryDatabase,
  options: { maxRuns?: number } = {},
): TraceRepository {
  const { orm } = db;
  const maxRuns = options.maxRuns ?? DEFAULT_TRACE_RUNS_KEPT;
  const exists = (runId: RunId) =>
    orm.select({ id: traceRuns.runId }).from(traceRuns).where(eq(traceRuns.runId, runId)).get() !== undefined;

  /** Keeps the newest `maxRuns` runs; their spans go with them. */
  function prune(): void {
    db.driver
      .prepare(
        `DELETE FROM trace_runs WHERE run_id IN (
           SELECT run_id FROM trace_runs ORDER BY started_at DESC, run_id DESC LIMIT -1 OFFSET ?)`,
      )
      .run(maxRuns);
  }

  return {
    recordRun(input) {
      const parsed = traceRunSchema.safeParse(input);
      if (!parsed.success) return invalid('run', parsed.error);
      const run = parsed.data;
      return inTransaction(db, 'trace_run', () => {
        const fresh = !exists(run.runId);
        const values = {
          conversationId: run.conversationId,
          status: run.status,
          message: redactText(run.message),
          endedAt: run.endedAt ?? null,
          ...(run.gaps ? { gaps: redactSecrets(run.gaps) } : {}),
        };
        orm
          .insert(traceRuns)
          .values({ runId: run.runId, startedAt: run.startedAt, ...values })
          .onConflictDoUpdate({ target: traceRuns.runId, set: values })
          .run();
        if (fresh) prune();
        return ok(undefined);
      });
    },

    recordSpan(runId, input) {
      const parsed = traceSpanSchema.safeParse(input);
      if (!parsed.success) return invalid('span', parsed.error);
      const { spanId, parentSpanId, kind, name, startedAt, endedAt, status, ...measured } = parsed.data;
      const { inputTokens, outputTokens, cachedInputTokens, costUsd, cacheHit, ...rest } = measured;
      // Everything else (provider, model, tool, error code, events…) is kept as JSON.
      const attributes = redactSecrets(rest);
      return inTransaction(db, 'trace_span', () => {
        if (!exists(runId)) {
          orm
            .insert(traceRuns)
            .values({ runId, conversationId: null, status: 'running', message: '', startedAt, endedAt: null })
            .run();
          prune();
        }
        const values = {
          parentSpanId,
          kind,
          name: redactText(name),
          status,
          startedAt,
          endedAt: endedAt ?? null,
          inputTokens: inputTokens ?? null,
          outputTokens: outputTokens ?? null,
          cachedInputTokens: cachedInputTokens ?? null,
          costUsd: costUsd ?? null,
          cacheHit: cacheHit ?? null,
          attributes,
        };
        orm
          .insert(traceSpans)
          .values({ runId, spanId, ...values })
          .onConflictDoUpdate({ target: [traceSpans.runId, traceSpans.spanId], set: values })
          .run();
        return ok(undefined);
      });
    },

    runs(options = {}) {
      const rows = db.driver
        .prepare(
          `SELECT r.run_id, r.conversation_id, r.status, r.message, r.started_at, r.ended_at,
             json_array_length(r.gaps) AS gap_count,
             coalesce(sum(s.kind = 'model'), 0) AS model_calls,
             coalesce(sum(s.kind = 'tool'), 0) AS tool_calls,
             coalesce(sum(CASE WHEN s.kind IN ('model', 'tool') THEN
               coalesce(s.input_tokens, 0) + coalesce(s.cached_input_tokens, 0) + coalesce(s.output_tokens, 0) END), 0) AS tokens,
             coalesce(sum(CASE WHEN s.kind IN ('model', 'tool') THEN coalesce(s.cost_usd, 0) END), 0) AS cost_usd,
             coalesce(sum(s.kind = 'tool' AND s.cache_hit = 1), 0) AS cache_hits
           FROM (SELECT * FROM trace_runs ORDER BY started_at DESC, run_id DESC LIMIT ?) r
           LEFT JOIN trace_spans s ON s.run_id = r.run_id
           GROUP BY r.run_id
           ORDER BY r.started_at DESC, r.run_id DESC`,
        )
        .all(pageSize(options.limit, 50, 200));
      return rows.map((r) => ({
        runId: r.run_id as RunId,
        conversationId: (r.conversation_id ?? null) as TraceSummary['conversationId'],
        status: r.status as TraceSummary['status'],
        message: String(r.message),
        startedAt: Number(r.started_at),
        ...(r.ended_at === null || r.ended_at === undefined ? {} : { endedAt: Number(r.ended_at) }),
        modelCalls: Number(r.model_calls),
        toolCalls: Number(r.tool_calls),
        tokens: Number(r.tokens),
        costUsd: Number(r.cost_usd),
        cacheHits: Number(r.cache_hits),
        complete: Number(r.gap_count) === 0,
      }));
    },

    get(runId) {
      const run = orm.select().from(traceRuns).where(eq(traceRuns.runId, runId)).get();
      if (!run) return err(NotFoundError({ entity: 'run', id: runId }));
      const spans = orm
        .select()
        .from(traceSpans)
        .where(eq(traceSpans.runId, runId))
        .orderBy(asc(traceSpans.startedAt), sql`${traceSpans.spanId}`)
        .all()
        .map(toSpan);
      return ok({
        runId: run.runId,
        conversationId: run.conversationId,
        status: run.status,
        message: run.message,
        startedAt: run.startedAt,
        ...(run.endedAt === null ? {} : { endedAt: run.endedAt }),
        spans: depthFirst(spans),
        gaps: run.gaps as TraceGap[],
      });
    },
  };
}
