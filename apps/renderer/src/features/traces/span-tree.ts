// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Pure helpers for drawing a trace: order, depth, the time window and totals. */
import type { Span, Trace } from '@taalcut/core';

export interface PlacedSpan {
  readonly span: Span;
  readonly depth: number;
  /** Start and end as fractions (0–1) of the run's window. */
  readonly from: number;
  readonly to: number;
  /** End is the window's end because the span hasn't finished. */
  readonly open: boolean;
}

/** The run's window: first start to last end, or the latest moment seen while it runs. */
export function traceWindow(trace: Trace): { start: number; end: number } {
  const start = Math.min(trace.startedAt, ...trace.spans.map((s) => s.startedAt));
  const end = Math.max(
    trace.endedAt ?? 0,
    ...trace.spans.map((s) => s.endedAt ?? s.startedAt),
    ...trace.spans.flatMap((s) => s.events.map((e) => e.at)),
  );
  return { start, end: Math.max(end, start + 1) };
}

/** Depth-first, children after their parent in start order. Orphans (missing parent) sit at the top level. */
export function placeSpans(trace: Trace): PlacedSpan[] {
  const { start, end } = traceWindow(trace);
  const length = end - start;
  const ids = new Set(trace.spans.map((s) => s.spanId));
  const children = new Map<string | null, Span[]>();
  for (const span of trace.spans) {
    const parent = span.parentSpanId && ids.has(span.parentSpanId) ? span.parentSpanId : null;
    children.set(parent, [...(children.get(parent) ?? []), span]);
  }
  const placed: PlacedSpan[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = [...(children.get(parent) ?? [])].sort((a, b) => a.startedAt - b.startedAt);
    for (const span of list) {
      const spanEnd = span.endedAt ?? end;
      placed.push({
        span,
        depth,
        from: (span.startedAt - start) / length,
        to: (spanEnd - start) / length,
        open: span.endedAt === undefined,
      });
      walk(span.spanId, depth + 1);
    }
  };
  walk(null, 0);
  return placed;
}

export function spanDuration(span: Span, windowEnd: number): number {
  return (span.endedAt ?? windowEnd) - span.startedAt;
}

export interface TraceTotals {
  readonly modelCalls: number;
  readonly toolCalls: number;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly costUsd: number;
  readonly cacheHits: number;
  readonly retries: number;
}

/** Totals over model and tool spans only (steps and the run would count them twice). */
export function traceTotals(trace: Trace): TraceTotals {
  const leaves = trace.spans.filter((s) => s.kind === 'model' || s.kind === 'tool');
  const sum = (pick: (s: Span) => number | undefined) => leaves.reduce((n, s) => n + (pick(s) ?? 0), 0);
  return {
    modelCalls: leaves.filter((s) => s.kind === 'model').length,
    toolCalls: leaves.filter((s) => s.kind === 'tool').length,
    inputTokens: sum((s) => s.inputTokens),
    cachedInputTokens: sum((s) => s.cachedInputTokens),
    outputTokens: sum((s) => s.outputTokens),
    costUsd: sum((s) => s.costUsd),
    cacheHits: leaves.filter((s) => s.cacheHit).length,
    retries: leaves.reduce((n, s) => n + s.events.filter((e) => e.name === 'retry').length, 0),
  };
}
