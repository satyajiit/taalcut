// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * How the run used each resource class and lane (IX-B2): busy (the sum of its jobs' running time), wall (the
 * time at least one of its jobs ran), their ratio (the mean number running while any ran: 1.0 means one at a
 * time) and the most that ran at once. Today every model stage shares `gpu` at a limit of 1, so its ratio is
 * 1.0; lanes (design A) should raise the class ratio while each lane stays at its own limit.
 */
import { ran, type StageSpan } from './spans';

export interface Usage {
  /** A resource class ('gpu'), or a lane ('vision.embedder'); jobs without a lane are '(no lane)'. */
  readonly name: string;
  readonly jobs: number;
  readonly busyMs: number;
  readonly wallMs: number;
  /** busy / wall. */
  readonly overlap: number;
  readonly peak: number;
  readonly firstStartMs: number;
  readonly lastFinishMs: number;
}

interface Interval {
  readonly from: number;
  readonly to: number;
}

/** The union's length and the most intervals open at one moment. */
function coverage(intervals: readonly Interval[]): { wallMs: number; peak: number } {
  const edges = intervals
    .flatMap((interval) => [
      { at: interval.from, step: 1 },
      { at: interval.to, step: -1 },
    ])
    // Ends before starts at the same moment: back-to-back jobs are not concurrent.
    .sort((left, right) => left.at - right.at || left.step - right.step);
  let open = 0;
  let peak = 0;
  let wallMs = 0;
  let since = 0;
  for (const edge of edges) {
    if (open > 0) wallMs += edge.at - since;
    open += edge.step;
    peak = Math.max(peak, open);
    since = edge.at;
  }
  return { wallMs, peak };
}

function usageOf(name: string, intervals: readonly Interval[]): Usage {
  const busyMs = intervals.reduce((sum, interval) => sum + (interval.to - interval.from), 0);
  const { wallMs, peak } = coverage(intervals);
  return {
    name,
    jobs: intervals.length,
    busyMs,
    wallMs,
    overlap: wallMs === 0 ? 0 : Math.round((busyMs / wallMs) * 100) / 100,
    peak,
    firstStartMs: Math.min(...intervals.map((interval) => interval.from)),
    lastFinishMs: Math.max(...intervals.map((interval) => interval.to)),
  };
}

function group(spans: readonly StageSpan[], key: (span: StageSpan) => string | null): Usage[] {
  const groups = new Map<string, Interval[]>();
  for (const span of spans) {
    const name = key(span);
    if (name === null || !ran(span)) continue;
    groups.set(name, [...(groups.get(name) ?? []), { from: span.startedMs, to: span.finishedMs }]);
  }
  return [...groups.entries()]
    .map(([name, intervals]) => usageOf(name, intervals))
    .sort((left, right) => right.busyMs - left.busyMs);
}

export const NO_LANE = '(no lane)';

export interface LaneUsage {
  readonly classes: readonly Usage[];
  /** Per lane within each class: `<class>/<lane>`. */
  readonly lanes: readonly Usage[];
}

export function laneUsage(spans: readonly StageSpan[]): LaneUsage {
  return {
    classes: group(spans, (span) => span.resource),
    lanes: group(spans, (span) =>
      span.resource === null ? null : `${span.resource}/${span.lane ?? NO_LANE}`,
    ),
  };
}
