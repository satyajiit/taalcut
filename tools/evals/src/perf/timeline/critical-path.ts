// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The critical path (IX-B2): the chain of stages and waits that decided when a finish line was reached,
 * walked back from the stage that finished last to Add folder. Each step asks what let this stage start:
 *
 * - it was queued and then waited for a slot in its resource class: if another job of the class finished
 *   while it waited (the latest one before it started), that job's release let it start, and the path
 *   continues through that job (often another asset's stage: the class was the bottleneck);
 * - otherwise it was fed when its last need finished: the path continues through that need (same asset);
 *   the gap between the need's finish and the queueing is the pipeline's feed wait, and a wait for a slot
 *   no release explains is the engine's claim wait;
 * - a stage with no need was waiting on the import (scan and hash start) since Add folder.
 *
 * The segments cover [0, end] with no gaps: 'run' (a stage's job ran), 'wait-slot', 'wait-feed', 'import'.
 */
import { ran, settledState, type StageSpan } from './spans';

/** A wait shorter than this is the engine's own latency, not a wait for a slot. */
const SLOT_WAIT_MS = 100;
/** Clock and write-order slack between one job's finish and the next one's start. */
const SLACK_MS = 20;

export type SegmentType = 'run' | 'wait-slot' | 'wait-feed' | 'import';

export interface PathSegment {
  readonly type: SegmentType;
  readonly fromMs: number;
  readonly toMs: number;
  /** The stage this segment belongs to (the one that ran, or the one that waited). */
  readonly file: string | null;
  readonly stage: string | null;
  readonly resource: string | null;
  readonly lane: string | null;
}

export interface CriticalPath {
  readonly endMs: number;
  readonly target: { readonly file: string; readonly stage: string };
  readonly segments: readonly PathSegment[];
  /** Ms per segment type, per stage (runs only) and per resource class (runs only). */
  readonly byType: Readonly<Record<string, number>>;
  readonly byStage: Readonly<Record<string, number>>;
  readonly byResource: Readonly<Record<string, number>>;
}

type Needs = (stage: string) => readonly string[];

function segment(type: SegmentType, fromMs: number, toMs: number, span: StageSpan | null): PathSegment {
  return {
    type,
    fromMs,
    toMs,
    file: span?.file ?? null,
    stage: span?.stage ?? null,
    resource: span?.resource ?? null,
    lane: span?.lane ?? null,
  };
}

const key = (span: StageSpan) => `${span.assetId}\u0000${span.stage}`;

/** Of the finished spans `accepts` takes (given each one's finish) that the path has not visited, the last to finish. */
function lastFinishing(
  spans: readonly StageSpan[],
  seen: Set<string>,
  accepts: (other: StageSpan, finishedMs: number) => boolean,
): StageSpan | null {
  let best: StageSpan | null = null;
  for (const other of spans) {
    const finished = other.finishedMs;
    if (finished === null || seen.has(key(other)) || !accepts(other, finished)) continue;
    if (best === null || (best.finishedMs ?? 0) < finished) best = other;
  }
  return best;
}

/** The job of the same class whose finish, while `span` waited, came last before it started. */
function releaser(spans: readonly StageSpan[], span: StageSpan, queued: number, seen: Set<string>) {
  if (span.resource === null || span.startedMs === null || span.startedMs - queued < SLOT_WAIT_MS)
    return null;
  const start = span.startedMs;
  return lastFinishing(
    spans,
    seen,
    (other, finished) =>
      other.resource === span.resource && ran(other) && finished >= queued && finished <= start + SLACK_MS,
  );
}

/** The asset's need that finished last, by `before`. */
function lastNeed(
  spans: readonly StageSpan[],
  span: StageSpan,
  before: number,
  needs: Needs,
  seen: Set<string>,
) {
  const wanted = new Set(needs(span.stage));
  return lastFinishing(
    spans,
    seen,
    (other, finished) =>
      other.assetId === span.assetId &&
      wanted.has(other.stage) &&
      settledState(other.state) &&
      finished <= before + SLACK_MS,
  );
}

function totals(segments: readonly PathSegment[], pick: (segment: PathSegment) => string | null) {
  const sums: Record<string, number> = {};
  for (const item of segments) {
    const name = pick(item);
    if (name !== null) sums[name] = (sums[name] ?? 0) + (item.toMs - item.fromMs);
  }
  return sums;
}

/**
 * One step back along the path from `current`: pushes its run and what it waited for onto `reversed` (newest
 * first) and returns the span the wait leads to, or null at the start of the run.
 */
function stepBack(
  spans: readonly StageSpan[],
  current: StageSpan,
  needs: Needs,
  seen: Set<string>,
  reversed: PathSegment[],
): StageSpan | null {
  seen.add(key(current));
  const end: number = reversed[reversed.length - 1]?.fromMs ?? current.finishedMs ?? 0;
  // A skipped stage ran nothing: it settled when the pipeline decided, right after its needs.
  const start = ran(current) ? current.startedMs : (current.finishedMs ?? end);
  if (ran(current)) reversed.push(segment('run', start, Math.min(end, current.finishedMs), current));
  const queued = ran(current) ? Math.min(current.queuedMs ?? start, start) : start;
  const release = releaser(spans, current, queued, seen);
  if (release !== null && release.finishedMs !== null) {
    if (start > release.finishedMs) reversed.push(segment('wait-slot', release.finishedMs, start, current));
    return release;
  }
  if (start > queued) reversed.push(segment('wait-slot', queued, start, current));
  const need = lastNeed(spans, current, queued, needs, seen);
  if (need === null || need.finishedMs === null) {
    if (queued > 0) reversed.push(segment('import', 0, queued, current));
    return null;
  }
  if (queued > need.finishedMs) reversed.push(segment('wait-feed', need.finishedMs, queued, current));
  return need;
}

export function criticalPath(spans: readonly StageSpan[], target: StageSpan, needs: Needs): CriticalPath {
  if (target.finishedMs === null) throw new Error(`${target.file} ${target.stage} never finished`);
  const reversed: PathSegment[] = [];
  const seen = new Set<string>();
  // Each step moves to a span that finished no later than the current one started, so this ends.
  for (let current: StageSpan | null = target; current !== null;)
    current = stepBack(spans, current, needs, seen, reversed);
  const segments = reversed.reverse().filter((item) => item.toMs > item.fromMs);
  return {
    endMs: target.finishedMs,
    target: { file: target.file, stage: target.stage },
    segments,
    byType: totals(segments, (item) => item.type),
    byStage: totals(segments, (item) => (item.type === 'run' ? item.stage : null)),
    byResource: totals(segments, (item) => (item.type === 'run' ? item.resource : null)),
  };
}

/** The stage row that finished last among `spans` (settled ones only). */
export function lastFinished(spans: readonly StageSpan[]): StageSpan | null {
  let last: StageSpan | null = null;
  for (const span of spans)
    if (
      settledState(span.state) &&
      span.finishedMs !== null &&
      (last === null || span.finishedMs > (last.finishedMs ?? 0))
    )
      last = span;
  return last;
}
