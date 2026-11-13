// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * soundOnCuts (EAR1-A2): every cut the timeline placed a sound effect for gets its sound, as the render is heard
 * (core's SoundListener: audio's cut sync, earshot's matcher). A planned hit counts as landed when an onset is
 * within a frame (`ok`) or 100 ms (`near`), or a swell peaks within 300 ms; a level peak alone, an onset 100–250 ms
 * off, or nothing is a miss (core's CUT_SYNC_MISSES). Cuts no effect was placed for are not judged, even under an
 * earlier effect's tail (EAR1-R4, qa/modules/sound-listening.ts `soundCuts`): a music-led edit may leave them dry on
 * purpose. Each missed cut is a finding with its offset (ms, sound minus cut).
 */
import { CUT_SYNC_MISSES, type CutSyncReport, type CutSyncStatus, type QaCheckResult } from '@taalcut/core';
import { agentFix, checkResult, skipped, type QaFinding } from '../result';
import { QA_THRESHOLDS } from '../thresholds.v1';

export interface SoundOnCutsInput {
  readonly cutSync: CutSyncReport;
  /** The cuts heard, in the order the listener was given them: the render frame of each and its incoming clip. */
  readonly cuts: readonly { readonly frame: number; readonly to: string }[];
  /** Indices into `cuts` a sound effect was placed for. */
  readonly planned: ReadonlySet<number>;
  readonly durationMs?: number;
}

const MISSES: readonly CutSyncStatus[] = CUT_SYNC_MISSES;

export function soundOnCutsCheck(input: SoundOnCutsInput): QaCheckResult {
  const duration = input.durationMs ?? 0;
  const judged = input.cutSync.items.filter((item) => input.planned.has(item.cutIndex));
  if (judged.length === 0) return skipped('soundOnCuts', duration);
  const missed = judged.filter((item) => MISSES.includes(item.status));
  const landed = 1 - missed.length / judged.length;
  const { minLandedShare } = QA_THRESHOLDS.sound.onCuts;
  const findings: QaFinding[] = missed.map((item) => {
    const cut = input.cuts[item.cutIndex];
    const frame = cut?.frame ?? 0;
    return {
      frames: { start: frame, end: frame + 1 },
      ...(cut ? { target: { kind: 'clip' as const, id: cut.to.slice(0, 64) } } : {}),
      ...(item.offsetMs !== null ? { measured: { value: item.offsetMs, unit: 'ms' as const } } : {}),
    };
  });
  const passed = landed >= minLandedShare;
  return checkResult(
    'soundOnCuts',
    passed ? 'pass' : 'fail',
    {
      measured: { value: Math.round(landed * 1000) / 10, unit: 'percent' },
      threshold: { min: minLandedShare * 100, unit: 'percent' },
      findings: passed ? [] : findings,
      // The Editor places the effects again, each loudest moment on its cut (sfx.addHits).
      fixes: [agentFix('qa.fixes.resyncHits', { cuts: missed.length })],
    },
    duration,
  );
}
