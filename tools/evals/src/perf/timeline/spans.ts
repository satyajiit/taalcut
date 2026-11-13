// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stage rows as spans on the run's clock (IX-B2): milliseconds from Add folder, with when the stage's job was
 * queued (fed to the engine), started (claimed a slot) and finished, its resource class from the job row and
 * its lane from the pipeline the run recorded (null while kinds declare none: "no lane"). A skipped stage has
 * no job; it finished when the pipeline decided to skip it.
 */
import type { PipelineGraph } from '../bench/run-record';
import type { StageRow } from './library-rows';

export interface StageSpan {
  readonly assetId: string;
  readonly file: string;
  readonly assetKind: string;
  readonly stage: string;
  readonly state: string;
  readonly reason: string | null;
  readonly kind: string | null;
  /** The job row's class; null for a stage that ran no job. */
  readonly resource: string | null;
  readonly lane: string | null;
  /** Ms from Add folder; null when the stage never got that far. */
  readonly queuedMs: number | null;
  readonly startedMs: number | null;
  readonly finishedMs: number | null;
  /** The job's claim-order key (the asset's import order under design B), when the run's jobs have one. */
  readonly orderKey: number | null;
}

/** Done or skipped: the stage no longer holds the asset back. */
export const settledState = (state: string): boolean => state === 'done' || state === 'skipped';

export function stageSpans(rows: readonly StageRow[], addedAt: number, pipeline: PipelineGraph): StageSpan[] {
  const at = (value: number | null) => (value === null ? null : value - addedAt);
  return rows.map((row) => ({
    assetId: row.assetId,
    file: row.file,
    assetKind: row.assetKind,
    stage: row.stage,
    state: row.state,
    reason: row.reason,
    kind: row.jobKind,
    resource: row.resource,
    lane: row.jobKind === null ? null : (pipeline.kinds[row.jobKind]?.lane ?? null),
    queuedMs: at(row.queuedAt),
    // The job's own times when it has them (the row copies them; the job is the source).
    startedMs: at(row.jobStartedAt ?? row.startedAt),
    finishedMs: at(row.jobFinishedAt ?? row.finishedAt),
    orderKey: row.orderKey,
  }));
}

/** A span that ran: it has both ends. */
export interface RanSpan extends StageSpan {
  readonly startedMs: number;
  readonly finishedMs: number;
}

export const ran = (span: StageSpan): span is RanSpan =>
  span.startedMs !== null && span.finishedMs !== null && span.finishedMs >= span.startedMs;
