// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * stylePacing (LRN1-STY): a render made like a set of the user's references (the project follows a style
 * profile, `styleProfile.use`) keeps its median shot inside the set's pacing band, the middle half of the set's
 * shot lengths widened by STYLE_PACING_SLACK on each side. Outside it fails, overridably (the user may want this
 * video slower or faster than the set), with an agent fix that tells the Editor which way to re-time and the
 * shots furthest out as findings. A render without shots, or of a project that follows no set, is skipped.
 */
import type { AsyncResult, ProjectId, QaCheckResult, StyleBand } from '@taalcut/core';
import type { FrameSpan, PlannedBumpers, PlannedVisual } from '../../plan/types';
import { agentFix, checkResult, skipped, spanFinding, type QaFinding } from '../result';

/** How far outside the set's quartiles a render's median shot may sit: a share of the quartile. */
export const STYLE_PACING_SLACK = 0.1;

/** One shot of the render: an enabled V1 clip outside the bumpers, by its cut. */
export interface StylePacingShot {
  readonly id: string;
  readonly span: FrameSpan;
}

/** What QA knows about the style a render is made like (QaFacts.stylePacing). */
export interface StylePacingFact {
  /** The set's shot lengths in seconds (core's StyleProfile pacing.shot). */
  readonly band: StyleBand;
  readonly shots: readonly StylePacingShot[];
}

/**
 * The pacing band of the set a project is made like, or null when it follows none or the set has no profile
 * (the render root reads the library's style profiles).
 */
export type StylePacingSource = (projectId: ProjectId) => AsyncResult<StyleBand | null>;

const overlaps = (a: FrameSpan, b: FrameSpan | null) => b !== null && a.start < b.end && b.start < a.end;

/** The render's shots: enabled V1 clips by their cut, the Style's intro and outro left out. */
export function stylePacingShots(plan: {
  readonly visuals: readonly Pick<PlannedVisual, 'id' | 'cut' | 'enabled'>[];
  readonly bumpers: Pick<PlannedBumpers, 'intro' | 'outro'>;
}): StylePacingShot[] {
  return plan.visuals
    .filter((visual) => visual.enabled)
    .filter(
      (visual) => !overlaps(visual.cut, plan.bumpers.intro) && !overlaps(visual.cut, plan.bumpers.outro),
    )
    .map((visual) => ({ id: visual.id, span: visual.cut }));
}

export interface StylePacingInput extends StylePacingFact {
  readonly rate: { readonly num: number; readonly den: number };
}

const round3 = (value: number) => Math.round(value * 1000) / 1000;

/** The median of sorted values (the middle one, or the mean of the middle two). */
function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1 ? upper : ((sorted[middle - 1] ?? upper) + upper) / 2;
}

/** The band a render's median shot must sit in, in seconds. */
export function stylePacingLimits(band: StyleBand): { readonly min: number; readonly max: number } {
  return { min: round3(band.q1 * (1 - STYLE_PACING_SLACK)), max: round3(band.q3 * (1 + STYLE_PACING_SLACK)) };
}

export function stylePacingCheck(input: StylePacingInput, durationMs = 0): QaCheckResult {
  const seconds = (span: FrameSpan) => ((span.end - span.start) * input.rate.den) / input.rate.num;
  const shots = input.shots
    .map((shot) => ({ ...shot, seconds: seconds(shot.span) }))
    .filter((shot) => shot.seconds > 0);
  if (shots.length === 0 || input.band.n === 0) return skipped('stylePacing', durationMs);
  const lengths = shots.map((shot) => shot.seconds).sort((a, b) => a - b);
  const renderMedian = round3(median(lengths));
  const limits = stylePacingLimits(input.band);
  const fields = {
    measured: { value: renderMedian, unit: 'seconds' as const },
    threshold: { ...limits, unit: 'seconds' as const },
  };
  if (renderMedian >= limits.min && renderMedian <= limits.max)
    return checkResult('stylePacing', 'pass', fields, durationMs);

  const longer = renderMedian < limits.min;
  // The shots furthest out on the side the median went: the ones the Editor re-times first.
  const findings: QaFinding[] = shots
    .filter((shot) => (longer ? shot.seconds < limits.min : shot.seconds > limits.max))
    .sort((a, b) => (longer ? a.seconds - b.seconds : b.seconds - a.seconds) || (a.id < b.id ? -1 : 1))
    .map((shot) =>
      spanFinding(shot.span, { kind: 'clip', id: shot.id }, { value: round3(shot.seconds), unit: 'seconds' }),
    );
  const ms = (value: number) => Math.round(value * 1000);
  return checkResult(
    'stylePacing',
    'fail',
    {
      ...fields,
      findings,
      fixes: [
        agentFix('qa.fixes.matchStylePacing', {
          direction: longer ? 'longer' : 'shorter',
          renderMedianMs: ms(renderMedian),
          q1Ms: ms(input.band.q1),
          medianMs: ms(input.band.median),
          q3Ms: ms(input.band.q3),
          shots: findings.length,
        }),
      ],
    },
    durationMs,
  );
}
