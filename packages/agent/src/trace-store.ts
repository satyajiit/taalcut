// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keeps a TraceStore (the trace viewer's) up to date as runs go (P1-G5): a
 * run's header when it starts, when its status changes and when it ends (with
 * the gaps that leave its trace incomplete), and each span when it opens and
 * again when it closes. Writes are queued per run in log order; they never
 * hold a run up, and a failed write never fails it.
 */
import {
  createKeyedQueue,
  isId,
  type AsyncResult,
  type ConversationId,
  type RunStatus as LogRunStatus,
  type RunId,
  type ToolSideEffect,
} from '@taalcut/core';
import type { RunStatus } from './cards';
import type { AgentEvent } from './events';
import type { TraceRunRecord, TraceSpanRecord, TraceStore } from './ports';
import { createTraceBuilder, traceGaps, type Span, type Trace, type TraceBuilder } from './trace';

export interface TraceRecorder {
  /** Folds a logged event into its run's trace and queues the writes it causes. `log`: the run's events up to it. */
  record(event: AgentEvent, log: readonly AgentEvent[]): void;
  /** Resolves when every write queued for the run is done. */
  flush(runId: RunId): Promise<void>;
}

const STATUS: Record<RunStatus, LogRunStatus> = {
  running: 'running',
  paused: 'paused',
  completed: 'succeeded',
  failed: 'failed',
  cancelled: 'cancelled',
};
const STOP = { stop: 'end', length: 'max_tokens', tool_use: 'tool_calls' } as const;
const ENDED: readonly LogRunStatus[] = ['succeeded', 'failed', 'cancelled'];

interface TracedRun {
  readonly builder: TraceBuilder;
  readonly header: Omit<TraceRunRecord, 'status'>;
  status?: LogRunStatus;
}

export function createTraceRecorder(store: TraceStore): TraceRecorder {
  const runs = new Map<RunId, TracedRun>();
  /**
   * Each run's writes in order. The store answers with a Result; one that throws instead breaks its port, and is
   * reported the way the limit follower reports a failed resume. Neither fails the run.
   */
  const writes = createKeyedQueue();
  const enqueue = (runId: RunId, write: () => AsyncResult<void>) =>
    void writes
      .run(runId, write)
      .catch((cause: unknown) =>
        console.warn(`[agent] a trace write for run ${runId} threw: ${String(cause)}`),
      );

  return {
    record(event, log) {
      const runId = event.runId;
      let run = runs.get(runId);
      let spans: readonly Span[];
      if (run) spans = run.builder.add(event);
      else {
        // A new run, or one reopened after a restart: catch up on its whole log (writes are upserts).
        const started = log[0]?.type === 'run.started' ? log[0] : undefined;
        if (!started) return;
        run = { builder: createTraceBuilder(runId), header: headerOf(started) };
        for (const logged of log) if (logged.seq <= event.seq) run.builder.add(logged);
        spans = run.builder.trace().spans;
        runs.set(runId, run);
      }
      const trace = run.builder.trace();
      const status = STATUS[trace.status];
      const traced = run;
      if (traced.status !== status) {
        traced.status = status;
        const ended = ENDED.includes(status);
        const record: TraceRunRecord = {
          ...traced.header,
          status,
          ...(ended ? { endedAt: event.at, gaps: gapsOf(trace) } : {}),
        };
        enqueue(runId, () => store.recordRun(record));
        if (ended) runs.delete(runId);
      }
      const records = spans.map((span) => spanRecord(span, trace, traced.header.message));
      for (const span of records) enqueue(runId, () => store.recordSpan(runId, span));
    },

    flush: (runId) => writes.settled(runId),
  };
}

function headerOf(started: Extract<AgentEvent, { type: 'run.started' }>): Omit<TraceRunRecord, 'status'> {
  const conversationId = started.payload.conversationId;
  return {
    runId: started.runId,
    conversationId: isId(conversationId) ? (conversationId as ConversationId) : null,
    message: started.payload.message,
    startedAt: started.at,
  };
}

/** One gap per span and reason. Seqs count from 1, as the library's run log numbers events. */
function gapsOf(trace: Trace): NonNullable<TraceRunRecord['gaps']> {
  const seen = new Set<string>();
  return traceGaps(trace).flatMap(({ spanId, seq, reason }) => {
    const key = `${spanId}\u0000${reason}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ spanId, seq: seq + 1, reason }];
  });
}

/** The store's span: the agent's attributes as named fields, open as 'running', stopped calls as 'cancelled'. */
export function spanRecord(span: Span, trace: Trace, message: string): TraceSpanRecord {
  const a = span.attributes;
  const text = (key: string) => (typeof a[key] === 'string' ? a[key] : undefined);
  const count = (key: string) => (typeof a[key] === 'number' ? Math.max(0, Math.round(a[key])) : undefined);
  const flag = (key: string) => (typeof a[key] === 'boolean' ? a[key] : undefined);
  const provider = text('provider');
  const model = text('model');
  const stop = text('stopReason') as keyof typeof STOP | undefined;
  const attempts = count('attempts');
  const cancelled = a.errorCode === 'core.cancelled' || (span.kind === 'run' && trace.status === 'cancelled');
  const name =
    span.kind === 'run'
      ? message
      : span.kind === 'model' && provider && model
        ? `${provider}/${model}`
        : span.kind === 'approval'
          ? (text('reason') ?? span.name)
          : span.name;
  const measured = {
    endedAt: span.endAt,
    provider,
    model,
    stopReason: stop ? STOP[stop] : undefined,
    inputTokens: count('inputTokens'),
    outputTokens: count('outputTokens'),
    cachedInputTokens: count('cachedInputTokens'),
    costUsd: typeof a.costUsd === 'number' ? Math.max(0, a.costUsd) : undefined,
    tool: span.kind === 'tool' ? span.name : undefined,
    version: text('version'),
    sideEffect: text('sideEffect') as ToolSideEffect | undefined,
    attempts: attempts ? attempts : undefined,
    cacheHit: flag('cached'),
    deduplicated: flag('deduplicated'),
    errorCode: text('errorCode'),
  };
  return {
    spanId: span.spanId,
    parentSpanId: span.parentSpanId ?? null,
    kind: span.kind,
    name,
    startedAt: span.startAt,
    status: span.status === 'open' ? 'running' : cancelled ? 'cancelled' : span.status,
    ...(Object.fromEntries(
      Object.entries(measured).filter(([, v]) => v !== undefined),
    ) as Partial<TraceSpanRecord>),
    events: [],
  };
}
