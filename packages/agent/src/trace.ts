// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tracing (G16 base, P1-G5): spans rebuilt from the run log alone, so a trace
 * survives a crash. The builder folds events one at a time and says which
 * spans each one opened or closed, so a trace store can keep up as the run
 * goes (trace-store.ts). The Trace object is the JSON the developer trace
 * viewer renders; toOtelSpans maps it to OpenTelemetry GenAI attribute names
 * for an optional exporter (no OTel dependency here).
 */
import { createHash } from 'node:crypto';
import type { RunId } from '@taalcut/core';
import type { RunStatus } from './cards';
import type { AgentEvent } from './events';

export type SpanKind = 'run' | 'step' | 'model' | 'tool' | 'approval';
export type SpanAttributes = Record<string, string | number | boolean>;

export interface Span {
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly kind: SpanKind;
  readonly name: string;
  readonly startAt: number;
  /** Seq of the logged event that opened it. */
  readonly seq: number;
  endAt?: number;
  status: 'ok' | 'error' | 'open';
  readonly attributes: SpanAttributes;
}

export interface Trace {
  readonly version: 1;
  readonly runId: RunId;
  readonly status: RunStatus;
  readonly totals: { tokens: number; usd: number; modelCalls: number; toolCalls: number; cacheHits: number };
  readonly spans: Span[];
}

export interface TraceBuilder {
  /** Folds the run's next logged event. Returns the spans it opened or closed. */
  add(event: AgentEvent): Span[];
  trace(): Trace;
}

export function buildTrace(runId: RunId, events: readonly AgentEvent[]): Trace {
  const builder = createTraceBuilder(runId);
  for (const event of events) builder.add(event);
  return builder.trace();
}

export function createTraceBuilder(runId: RunId): TraceBuilder {
  const spans = new Map<string, Span>();
  const totals = { tokens: 0, usd: 0, modelCalls: 0, toolCalls: 0, cacheHits: 0 };
  let status: RunStatus = 'running';
  let stepSpan: string | undefined;
  let touched: Span[] = [];
  const open = (event: AgentEvent, span: Omit<Span, 'status' | 'startAt' | 'seq'>) => {
    const opened: Span = { ...span, startAt: event.at, seq: event.seq, status: 'open' };
    spans.set(opened.spanId, opened);
    touched.push(opened);
  };
  const close = (id: string, at: number, ok: boolean, attributes: SpanAttributes = {}) => {
    const span = spans.get(id);
    if (!span) return;
    span.endAt = at;
    span.status = ok ? 'ok' : 'error';
    Object.assign(span.attributes, attributes);
    touched.push(span);
  };

  function apply(event: AgentEvent): void {
    const parent = stepSpan ?? runId;
    switch (event.type) {
      case 'run.started':
        open(event, {
          spanId: runId,
          kind: 'run',
          name: 'agent.run',
          attributes: {
            autonomy: event.payload.autonomy,
            soulVersion: event.payload.soulVersion,
            ...(event.payload.effort ? { effort: event.payload.effort } : {}),
            ...(event.payload.reasoning ? { reasoning: event.payload.reasoning } : {}),
          },
        });
        break;
      case 'step.started':
        stepSpan = `step:${event.payload.stepId}:${event.seq}`;
        open(event, {
          spanId: stepSpan,
          parentSpanId: runId,
          kind: 'step',
          name: event.payload.text,
          attributes: { stepId: event.payload.stepId },
        });
        break;
      case 'checkpoint.saved':
        if (stepSpan) close(stepSpan, event.at, true);
        stepSpan = undefined;
        break;
      case 'model.requested':
        open(event, {
          spanId: event.payload.modelCallId,
          parentSpanId: parent,
          kind: 'model',
          name: `model.${event.payload.phase}`,
          attributes: { phase: event.payload.phase, estimatedTokens: event.payload.estimate.tokens },
        });
        break;
      case 'model.responded': {
        const { usage } = event.payload;
        totals.modelCalls += 1;
        totals.tokens += usage.totalTokens;
        totals.usd += usage.costUsd;
        close(event.payload.modelCallId, event.at, true, {
          provider: event.payload.provider,
          model: event.payload.model,
          local: event.payload.local,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          cachedInputTokens: usage.cachedInputTokens,
          costUsd: usage.costUsd,
          latencyMs: event.payload.latencyMs,
          stopReason: event.payload.stopReason,
          toolCalls: event.payload.toolCalls.length,
          ...(event.payload.reasoning ? { reasoning: event.payload.reasoning } : {}),
        });
        break;
      }
      case 'model.failed':
        close(event.payload.modelCallId, event.at, false, { errorCode: event.payload.error.code });
        break;
      case 'tool.requested':
        open(event, {
          spanId: event.payload.toolCallId,
          parentSpanId: parent,
          kind: 'tool',
          name: event.payload.tool,
          attributes: {
            tool: event.payload.tool,
            sideEffect: event.payload.sideEffect,
            meta: event.payload.meta,
          },
        });
        break;
      case 'tool.completed':
      case 'tool.failed': {
        const p = event.payload;
        if (!spans.get(p.toolCallId)?.attributes.meta) totals.toolCalls += 1;
        totals.tokens += p.usage.inputTokens + p.usage.outputTokens;
        totals.usd += p.usage.usd;
        const common = {
          latencyMs: p.durationMs,
          attempts: p.attempts,
          costUsd: p.usage.usd,
          inputTokens: p.usage.inputTokens,
          outputTokens: p.usage.outputTokens,
        };
        if (event.type === 'tool.failed') {
          close(p.toolCallId, event.at, false, {
            ...common,
            cached: false,
            errorCode: event.payload.error.code,
          });
          break;
        }
        const done = event.payload;
        if (done.cached) totals.cacheHits += 1;
        close(done.toolCallId, event.at, true, {
          ...common,
          cached: done.cached,
          deduplicated: done.deduplicated,
          ...(done.version ? { version: done.version } : {}),
          ...(done.approvalId ? { approvalId: done.approvalId } : {}),
          output: done.output.kind,
        });
        break;
      }
      case 'approval.requested':
        open(event, {
          spanId: `approval:${event.payload.requestId}`,
          parentSpanId: event.payload.toolCallIds[0] ?? parent,
          kind: 'approval',
          name: `approval.${event.payload.kind}`,
          attributes: {
            kind: event.payload.kind,
            reason: event.payload.reason,
            ...(event.payload.limit ? { limit: event.payload.limit } : {}),
          },
        });
        break;
      case 'approval.granted':
      case 'approval.denied':
        close(`approval:${event.payload.requestId}`, event.at, true, {
          decision: event.type === 'approval.granted' ? 'granted' : 'denied',
        });
        break;
      case 'run.paused':
        status = 'paused';
        break;
      case 'run.resumed':
        status = 'running';
        break;
      case 'run.completed':
      case 'run.failed':
      case 'run.cancelled':
        status =
          event.type === 'run.completed' ? 'completed' : event.type === 'run.failed' ? 'failed' : 'cancelled';
        if (stepSpan) close(stepSpan, event.at, status === 'completed');
        close(runId, event.at, status === 'completed', { tokens: totals.tokens, costUsd: totals.usd });
        break;
    }
  }

  return {
    add(event) {
      touched = [];
      apply(event);
      return touched;
    },
    trace: () => ({ version: 1, runId, status, totals: { ...totals }, spans: [...spans.values()] }),
  };
}

export type TraceGapReason = 'no-outcome' | 'no-tokens' | 'no-cost' | 'no-latency';

/** One reason a trace is incomplete. */
export interface TraceGap {
  readonly spanId: string;
  /** Seq of the event that opened the span. */
  readonly seq: number;
  readonly reason: TraceGapReason;
  /** For people: which span, and what it lacks. */
  readonly problem: string;
}

/** Numbers every ended model and tool span must have, and what their absence means. */
const REQUIRED: Partial<Record<SpanKind, Readonly<Record<string, TraceGapReason>>>> = {
  model: {
    provider: 'no-outcome',
    model: 'no-outcome',
    inputTokens: 'no-tokens',
    outputTokens: 'no-tokens',
    costUsd: 'no-cost',
    latencyMs: 'no-latency',
  },
  tool: {
    latencyMs: 'no-latency',
    costUsd: 'no-cost',
    inputTokens: 'no-tokens',
    outputTokens: 'no-tokens',
    cached: 'no-outcome',
    attempts: 'no-outcome',
  },
};

/** What makes a trace incomplete: open spans in an ended run, or ended spans missing their numbers. */
export function traceGaps(trace: Trace): TraceGap[] {
  const gaps: TraceGap[] = [];
  const ended = trace.status === 'completed' || trace.status === 'failed' || trace.status === 'cancelled';
  for (const span of trace.spans) {
    const gap = (reason: TraceGapReason, what: string) =>
      gaps.push({
        spanId: span.spanId,
        seq: span.seq,
        reason,
        problem: `${span.kind} span ${span.name} (${span.spanId}) ${what}`,
      });
    if (span.status === 'open') {
      if (ended) gap('no-outcome', 'never ended');
      continue;
    }
    const required = span.kind === 'model' && span.status === 'error' ? {} : (REQUIRED[span.kind] ?? {});
    for (const [key, reason] of Object.entries(required)) {
      if (!(key in span.attributes)) gap(reason, `has no ${key}`);
    }
  }
  return gaps;
}

/** traceGaps, as sentences: empty when the trace is complete. */
export function checkTrace(trace: Trace): string[] {
  return traceGaps(trace).map((gap) => gap.problem);
}

export interface OtelSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: 'INTERNAL' | 'CLIENT';
  readonly startTimeUnixNano: string;
  readonly endTimeUnixNano?: string;
  readonly attributes: SpanAttributes;
  readonly status: { readonly code: 'OK' | 'ERROR' | 'UNSET' };
}

/** OpenTelemetry-shaped spans with GenAI semantic-convention names. Never includes prompt or output text. */
export function toOtelSpans(trace: Trace): OtelSpan[] {
  const hex = (value: string, length: number) =>
    createHash('sha256').update(value).digest('hex').slice(0, length);
  const traceId = hex(trace.runId, 32);
  return trace.spans.map((span) => {
    const a = span.attributes;
    const genAi: SpanAttributes =
      span.kind === 'model'
        ? {
            'gen_ai.operation.name': 'chat',
            'gen_ai.provider.name': a.provider ?? '',
            'gen_ai.request.model': a.model ?? '',
            'gen_ai.usage.input_tokens': a.inputTokens ?? 0,
            'gen_ai.usage.output_tokens': a.outputTokens ?? 0,
          }
        : span.kind === 'tool'
          ? {
              'gen_ai.operation.name': 'execute_tool',
              'gen_ai.tool.name': span.name,
              'gen_ai.tool.call.id': span.spanId,
            }
          : {};
    return {
      traceId,
      spanId: hex(span.spanId, 16),
      ...(span.parentSpanId ? { parentSpanId: hex(span.parentSpanId, 16) } : {}),
      name: span.name,
      kind: span.kind === 'model' ? 'CLIENT' : 'INTERNAL',
      startTimeUnixNano: `${span.startAt}000000`,
      ...(span.endAt !== undefined ? { endTimeUnixNano: `${span.endAt}000000` } : {}),
      attributes: { ...prefixed(a), ...genAi },
      status: { code: span.status === 'ok' ? 'OK' : span.status === 'error' ? 'ERROR' : 'UNSET' },
    };
  });
}

function prefixed(attributes: SpanAttributes): SpanAttributes {
  return Object.fromEntries(Object.entries(attributes).map(([k, v]) => [`taalcut.${k}`, v]));
}

/** Keeps exported traces in memory (tests, and the dev "copy trace" button). */
export function createMemoryTraceExporter(): {
  readonly traces: Trace[];
  export(trace: Trace): Promise<void>;
} {
  const traces: Trace[] = [];
  return {
    traces,
    async export(trace) {
      traces.push(trace);
    },
  };
}
