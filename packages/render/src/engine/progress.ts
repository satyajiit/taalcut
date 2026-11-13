// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One export's progress (SPEC section 4, "Progress"): each stage owns a share
 * of the bar, measured on this Mac's renders, so the bar moves at a steady
 * pace instead of jumping. The ETA is the remaining share at the smoothed
 * rate (an exponential moving average of fraction per second), shown only
 * once there is enough to go on. Never more than 4 updates a second, except
 * a stage change.
 */
import type { JobProgress } from '@taalcut/core';

export const EXPORT_STAGES = [
  'preflight',
  'reframing',
  'grading',
  'conforming',
  'composing',
  'capturing',
  'mixingAudio',
  'finishing',
  'signing',
  'checking',
] as const;
export type ExportStage = (typeof EXPORT_STAGES)[number];

/**
 * Share of the whole export per stage (SPEC P3.11; sums to 1). A stage an export skips (no grade, credentials
 * off) gives its share to the others, so the bar still runs from 0 to 1.
 */
export const STAGE_WEIGHTS: Readonly<Record<ExportStage, number>> = {
  preflight: 0.02,
  reframing: 0.04,
  grading: 0.03,
  conforming: 0.13,
  composing: 0.01,
  capturing: 0.56,
  mixingAudio: 0.05,
  finishing: 0.02,
  signing: 0.01,
  checking: 0.13,
};

/** The stages only some exports run. */
export const OPTIONAL_STAGES: ReadonlySet<ExportStage> = new Set(['reframing', 'grading', 'signing']);

/** i18n key of a stage, e.g. 'render.stage.capturing'. */
export const stageKey = (stage: ExportStage | 'fixing') => `render.stage.${stage}`;

const MIN_INTERVAL_MS = 250;
/** No ETA before this much of the export is done or this long has passed. */
const ETA_AFTER_FRACTION = 0.05;
const ETA_AFTER_MS = 3_000;
const SMOOTHING = 0.2;

export interface ProgressTracker {
  /** Which optional stages this export runs (default: all of them); their shares are spread over the rest. */
  plan(active: readonly ExportStage[]): void;
  /** Enters a stage (published at once). 'fixing' keeps the bar where it is. */
  stage(stage: ExportStage | 'fixing'): void;
  /** Progress inside the current stage, 0 to 1. */
  within(
    fraction: number,
    counts?: { readonly completed: number; readonly total: number; readonly unit?: JobProgress['unit'] },
  ): void;
  /** The last published value. */
  current(): JobProgress;
}

/** A stage's share of the bar with the skipped stages' shares spread over the rest. */
function stageShare(name: ExportStage, skipped: ReadonlySet<ExportStage>): number {
  if (skipped.has(name)) return 0;
  const total = EXPORT_STAGES.reduce(
    (sum, stage) => sum + (skipped.has(stage) ? 0 : STAGE_WEIGHTS[stage]),
    0,
  );
  return STAGE_WEIGHTS[name] / total;
}

export function createProgressTracker(
  publish: (progress: JobProgress) => void,
  now: () => number = Date.now,
): ProgressTracker {
  const started = now();
  let current: ExportStage | 'fixing' = 'preflight';
  let base = 0;
  let fraction = 0;
  let lastAt = -Infinity;
  let rate: number | null = null;
  let sample: { at: number; fraction: number } = { at: started, fraction: 0 };
  let last: JobProgress = { fraction: 0, stageKey: stageKey('preflight') };

  const emit = (force: boolean, counts?: Pick<JobProgress, 'completed' | 'total' | 'unit'>) => {
    const at = now();
    if (!force && at - lastAt < MIN_INTERVAL_MS) return;
    if (at > sample.at && fraction > sample.fraction) {
      const instant = (fraction - sample.fraction) / (at - sample.at);
      rate = rate === null ? instant : rate + SMOOTHING * (instant - rate);
      sample = { at, fraction };
    }
    const etaReady =
      rate !== null && rate > 0 && (fraction >= ETA_AFTER_FRACTION || at - started >= ETA_AFTER_MS);
    last = {
      fraction: Math.min(1, Math.max(0, fraction)),
      stageKey: stageKey(current),
      ...(counts ?? {}),
      ...(etaReady ? { etaMs: Math.round((1 - fraction) / rate!) } : {}),
    };
    lastAt = at;
    publish(last);
  };

  let skipped: ReadonlySet<ExportStage> = new Set();
  const weight = (name: ExportStage) => stageShare(name, skipped);
  return {
    plan(active) {
      skipped = new Set([...OPTIONAL_STAGES].filter((name) => !active.includes(name)));
    },
    stage(stage) {
      if (stage !== 'fixing') {
        const index = EXPORT_STAGES.indexOf(stage);
        base = EXPORT_STAGES.slice(0, index).reduce((sum, name) => sum + weight(name), 0);
        fraction = Math.max(fraction, base);
      }
      current = stage;
      emit(true);
    },
    within(inside, counts) {
      if (current === 'fixing') return;
      const share = weight(current);
      fraction = Math.max(fraction, base + share * Math.min(1, Math.max(0, inside)));
      emit(false, counts);
    },
    current: () => last,
  };
}
