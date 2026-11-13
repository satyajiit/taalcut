// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * avSync and beatSync (docs/qa-gate.md). avSync needs all three parts: the
 * container's starts and lengths, each hard cut where the plan put it, and
 * the sound against its sources. beatSync is gate criterion 5 on every
 * render: each beat-anchored cut within one frame of its beat.
 */
import { TIMELINE_COMMANDS, type QaCheckResult } from '@taalcut/core';
import type { QaPlan } from '../../types';
import type { StreamFacts } from '../measure/stream-facts';
import { driftOver, type Correlation } from '../measure/sync';
import { autoFix, checkResult, commandFix, skipped, type QaFinding, type QaTarget } from '../result';
import { QA_THRESHOLDS } from '../thresholds.v1';

/** The frame in [from, to] with the highest scene score at or over the threshold, if any. */
export function cutPeak(scores: readonly number[], from: number, to: number): number | undefined {
  let best: number | undefined;
  for (let frame = Math.max(0, from); frame <= Math.min(to, scores.length - 1); frame++) {
    const score = scores[frame] ?? 0;
    if (score >= QA_THRESHOLDS.sceneChange.threshold && (best === undefined || score > (scores[best] ?? 0)))
      best = frame;
  }
  return best;
}

function audioSamples(facts: StreamFacts): number {
  const audio = facts.audio[0];
  if (!audio) return 0;
  const rate = audio.sampleRate ?? 48_000;
  if (audio.durationTs !== undefined && audio.timeBase === `1/${rate}`) return audio.durationTs;
  return Math.round((audio.duration ?? 0) * rate);
}

export interface AvSyncInput {
  readonly facts: StreamFacts;
  readonly plan: QaPlan;
  readonly sceneScores: readonly number[];
  /** One per planned window, in order; empty when the plan has none. */
  readonly correlations: readonly (Correlation & { readonly at: number })[];
}

export function avSyncCheck(input: AvSyncInput): QaCheckResult {
  const { facts, plan, sceneScores, correlations } = input;
  const { sync } = QA_THRESHOLDS;
  const findings: QaFinding[] = [];
  // 1. Container: both streams start at zero, lengths agree, the sample count is the plan's.
  const tolerance = QA_THRESHOLDS.container.startToleranceMs / 1000;
  const video = facts.video[0];
  const audio = facts.audio[0];
  if (Math.abs(video?.startTime ?? 0) > tolerance || Math.abs(audio?.startTime ?? 0) > tolerance)
    findings.push({ target: { kind: 'audio', id: 'start' }, measured: { value: Math.round((audio?.startTime ?? 0) * 1000), unit: 'ms' } });
  const frameSeconds = plan.rateDen / plan.rateNum;
  if (audio && video && Math.abs((audio.duration ?? 0) - (video.duration ?? 0)) >= frameSeconds)
    findings.push({
      target: { kind: 'audio', id: 'length' },
      measured: { value: Math.round(((audio.duration ?? 0) - (video.duration ?? 0)) * 1000), unit: 'ms' },
    });
  const expectedSamples = Math.round((plan.durationFrames * 48_000 * plan.rateDen) / plan.rateNum);
  if (audio && Math.abs(audioSamples(facts) - expectedSamples) > sync.sampleTolerance)
    findings.push({ target: { kind: 'audio', id: 'samples' }, measured: { value: audioSamples(facts) - expectedSamples, unit: 'count' } });
  // 2. Picture: each hard cut peaks on its planned frame (near-identical shots score under 8 and are skipped).
  for (const cut of plan.cuts) {
    const peak = cutPeak(sceneScores, cut.frame - QA_THRESHOLDS.sceneChange.searchFrames, cut.frame + QA_THRESHOLDS.sceneChange.searchFrames);
    if (peak !== undefined && peak !== cut.frame)
      findings.push({
        frames: { start: Math.min(peak, cut.frame), end: Math.max(peak, cut.frame) + 1 },
        target: { kind: 'clip', id: cut.to },
        measured: { value: peak - cut.frame, unit: 'frames' },
      });
  }
  // 3. Sound: conclusive windows within ±20 ms, and no more than 20 ms of drift over 60 s.
  const conclusive = correlations.filter((window) => window.peak >= sync.minCorrelation);
  let worst = 0;
  for (const window of conclusive) {
    worst = Math.max(worst, Math.abs(window.lagMs));
    if (Math.abs(window.lagMs) > sync.maxOffsetMs) {
      const frame = Math.round(window.at / frameSeconds);
      findings.push({
        frames: { start: frame, end: frame + Math.round(1 / frameSeconds) },
        target: { kind: 'audio', id: 'offset' },
        measured: { value: Math.round(window.lagMs * 10) / 10, unit: 'ms' },
      });
    }
  }
  const span = conclusive.length > 1 ? conclusive[conclusive.length - 1]!.at - conclusive[0]!.at : 0;
  // Over a short render a one-sample wobble would extrapolate to a large slope: read the spread instead.
  const lags = conclusive.map((window) => window.lagMs);
  const drift =
    span >= 10 ? driftOver(conclusive, sync.driftOverSeconds) : lags.length > 1 ? Math.max(...lags) - Math.min(...lags) : 0;
  if (Math.abs(drift) > sync.maxDriftMs)
    findings.push({ target: { kind: 'audio', id: 'drift' }, measured: { value: Math.round(drift * 10) / 10, unit: 'ms' } });
  const inconclusive = correlations.length > 0 && conclusive.length === 0;
  const status = findings.length > 0 ? 'fail' : inconclusive ? 'warn' : 'pass';
  return checkResult(
    'avSync',
    status,
    {
      measured: { value: Math.round(worst * 10) / 10, unit: 'ms' },
      threshold: { max: sync.maxOffsetMs, unit: 'ms' },
      findings,
      // Re-mix and re-mux first; a fresh render if the picture moved.
      fixes: [autoFix('rerender')],
    },
    0,
  );
}

export function beatSyncCheck(plan: QaPlan, sceneScores: readonly number[], target: QaTarget): QaCheckResult {
  if (plan.anchors.length === 0) return skipped('beatSync');
  const max = QA_THRESHOLDS.beat.maxFrames;
  const findings: QaFinding[] = [];
  let worst = 0;
  for (const anchor of plan.anchors) {
    // Where the timeline put the cut against its beat.
    let off = anchor.frame - anchor.beatFrame;
    // Where the render actually cut, for hard cuts the scene detector can see.
    const hard = plan.cuts.find((cut) => cut.frame === anchor.frame);
    const peak = hard ? cutPeak(sceneScores, anchor.frame - 3, anchor.frame + 3) : undefined;
    if (peak !== undefined && Math.abs(peak - anchor.beatFrame) > Math.abs(off)) off = peak - anchor.beatFrame;
    worst = Math.max(worst, Math.abs(off));
    if (Math.abs(off) > max)
      findings.push({
        frames: { start: Math.min(anchor.frame, anchor.beatFrame), end: Math.max(anchor.frame, anchor.beatFrame) + 1 },
        target: { kind: 'clip', id: anchor.clipId },
        measured: { value: off, unit: 'frames' },
      });
  }
  return checkResult(
    'beatSync',
    findings.length > 0 ? 'fail' : 'pass',
    {
      measured: { value: worst, unit: 'frames' },
      threshold: { max, unit: 'frames' },
      findings,
      fixes: [commandFix('qa.fixes.resyncBeats', TIMELINE_COMMANDS.resyncBeats, { ...target })],
    },
    0,
  );
}
