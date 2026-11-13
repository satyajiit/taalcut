// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Picture checks from the one video pass (docs/qa-gate.md: blackFrames,
 * frozenFrames, blackBars). A dark or static stretch outside the plan's
 * intended ranges is a finding; whether it is the render's fault or the
 * footage's is decided by looking at the clip's conformed segment there
 * (for a freeze, over the freeze's own frames as the render frames them).
 */
import { FrameRate, uniqueBy, type QaCheckResult, type QaFix } from '@taalcut/core';
import type { FrameSpan } from '../../plan/types';
import type { QaPlan } from '../../types';
import type { VideoPass } from '../measure/video-pass';
import {
  agentFix,
  autoFix,
  checkResult,
  clipAt,
  outside,
  overlaps,
  spanFinding,
  type QaFinding,
} from '../result';
import { QA_THRESHOLDS } from '../thresholds.v1';

/** The pass over one clip's conformed segment, and the render frame its first frame lands on. */
export interface SegmentPass {
  readonly pass: VideoPass;
  readonly startFrame: number;
}

export type SegmentPasses = (clipId: string) => Promise<SegmentPass | undefined>;

/**
 * How many frames from `span.start` on the clip's footage, as the render frames it, holds the picture it shows at
 * `span.start` (passes/source-stillness.ts); undefined when it couldn't be measured.
 */
export type SourceStillness = (clipId: string, span: FrameSpan) => Promise<number | undefined>;

/** Fixes de-duplicated by kind and action or key, so a dozen findings don't make a dozen buttons. */
export function uniqueFixes(fixes: readonly QaFix[]): QaFix[] {
  return uniqueBy(fixes, (fix) => JSON.stringify(fix));
}

/** True when the segment shows the same condition over most of the render span. */
function segmentHas(segment: SegmentPass | undefined, spans: readonly FrameSpan[], span: FrameSpan): boolean {
  if (!segment) return false;
  const local = { start: span.start - segment.startFrame, end: span.end - segment.startFrame };
  const covered = spans.reduce(
    (sum, other) => sum + Math.max(0, Math.min(other.end, local.end) - Math.max(other.start, local.start)),
    0,
  );
  return covered * 2 >= local.end - local.start;
}

const frameCount = (spans: readonly FrameSpan[]) =>
  spans.reduce((sum, span) => sum + span.end - span.start, 0);

/** A detector's minimum length in frames at the plan's rate. */
const minFrames = (plan: QaPlan, seconds: number) =>
  Math.max(1, Math.round((seconds * plan.rateNum) / plan.rateDen));

/**
 * Pieces at least as long as the detector's own minimum. A freeze or a dark stretch can start a frame before
 * the intended range it belongs to (a still that matches the frame before it, the dark edge of a dip); the
 * sliver left outside is not a stretch the detector would have reported on its own.
 */
function longEnough(parts: readonly FrameSpan[], plan: QaPlan, seconds: number): FrameSpan[] {
  const min = minFrames(plan, seconds);
  return parts.filter((part) => part.end - part.start >= min);
}

/**
 * A render freeze is the footage's when the footage, framed as the render frames it and compared with its own
 * picture at the freeze's first frame, holds still for at least half the freeze, and the render holds still beyond
 * it for less than a freeze's minimum length. A render-made still of the minimum length or more is never credited.
 */
function footageHolds(held: number | undefined, part: FrameSpan, min: number): boolean {
  if (held === undefined) return false;
  const frames = part.end - part.start;
  return held * 2 >= frames && frames - held < min;
}

export async function blackFramesCheck(
  pass: VideoPass,
  plan: QaPlan,
  segments?: SegmentPasses,
): Promise<QaCheckResult> {
  const findings: QaFinding[] = [];
  const fixes: QaFix[] = [];
  let unintended = 0;
  let opening = 0;
  for (const interval of pass.black) {
    const parts = longEnough(outside(interval, plan.intendedDark), plan, QA_THRESHOLDS.black.minSeconds);
    const titledOpening =
      parts.length === 0 &&
      (plan.texts.some((text) => text.span.start < interval.end && text.span.end > 0) ||
        (plan.graphics?.some((graphic) => graphic.span.start < interval.end && graphic.span.end > 0) ??
          false));
    // The hook must not open on blank black, even when the timeline asks for it (unless a title or graphic opens over an intended dark backdrop).
    if (interval.start === 0 && !titledOpening) {
      opening = interval.end;
      findings.push(spanFinding({ start: 0, end: interval.end }, { kind: 'file', id: 'openingFrame' }));
      if (parts.length === 0) fixes.push(agentFix('qa.fixes.openOnPicture', { frames: interval.end }));
    }
    for (const part of parts) {
      unintended += part.end - part.start;
      const clipId = clipAt(plan.clips, part);
      const segment = clipId ? await segments?.(clipId) : undefined;
      const sourceDark = segmentHas(segment, segment?.pass.black ?? [], part);
      findings.push(spanFinding(part, clipId ? { kind: 'clip', id: clipId } : undefined));
      fixes.push(
        sourceDark && clipId ? agentFix('qa.fixes.swapOrTrimDark', { clipId }) : autoFix('rerender'),
      );
    }
  }
  const failing = findings.length > 0;
  return checkResult(
    'blackFrames',
    failing ? 'fail' : 'pass',
    {
      measured: { value: Math.max(unintended, opening), unit: 'frames' },
      threshold: { max: 0, unit: 'frames' },
      findings,
      fixes: uniqueFixes(fixes),
    },
    0,
  );
}

export async function frozenFramesCheck(
  pass: VideoPass,
  plan: QaPlan,
  stillness?: SourceStillness,
): Promise<QaCheckResult> {
  const findings: QaFinding[] = [];
  const fixes: QaFix[] = [];
  let renderFault = false;
  const min = minFrames(plan, QA_THRESHOLDS.frozen.minSeconds);
  const parts = longEnough(
    pass.freezes.flatMap((freeze) => outside(freeze, plan.intendedStatic)),
    plan,
    QA_THRESHOLDS.frozen.minSeconds,
  );
  for (const part of parts) {
    const clipId = clipAt(plan.clips, part);
    const held = clipId ? await stillness?.(clipId, part) : undefined;
    const sourceStatic = footageHolds(held, part, min);
    findings.push(spanFinding(part, clipId ? { kind: 'clip', id: clipId } : undefined));
    if (sourceStatic && clipId) fixes.push(agentFix('qa.fixes.swapOrTrimStatic', { clipId }));
    else {
      renderFault = true;
      fixes.push(autoFix('rerender'));
    }
  }
  // A freeze the footage itself has is a warning ("this shot barely moves"); one the render made fails.
  const status = renderFault ? 'fail' : findings.length > 0 ? 'warn' : 'pass';
  return checkResult(
    'frozenFrames',
    status,
    {
      measured: { value: frameCount(parts), unit: 'frames' },
      threshold: { max: 0, unit: 'frames' },
      findings,
      fixes: uniqueFixes(fixes),
    },
    0,
  );
}

export function blackBarsCheck(pass: VideoPass, plan: QaPlan): QaCheckResult {
  const { minCoverage, minSeconds } = QA_THRESHOLDS.blackBars;
  const rate = FrameRate.of(plan.rateNum, plan.rateDen);
  const minFrames = Math.round((minSeconds * rate.num) / rate.den);
  const findings: QaFinding[] = [];
  const fixes: QaFix[] = [];
  let worst = 1;
  for (const clip of plan.clips) {
    if (clip.fit === 'contain') continue;
    let runStart = -1;
    let runCoverage = 1;
    const flush = (end: number) => {
      if (runStart >= 0 && end - runStart >= minFrames) {
        findings.push(
          spanFinding(
            { start: runStart, end },
            { kind: 'clip', id: clip.id },
            { value: runCoverage, unit: 'ratio' },
          ),
        );
        // Bars on a clip that already fills the frame are in the footage: setClipFit can't remove them, and a
        // Timeline v1 clip has no crop (reframing is Phase 3), so the fix is another take from the alternates.
        fixes.push(agentFix('qa.fixes.swapFromAlternates', { clipId: clip.id }));
      }
      runStart = -1;
      runCoverage = 1;
    };
    for (let frame = clip.span.start; frame < Math.min(clip.span.end, pass.frames); frame++) {
      const dark = plan.intendedDark.some((span) => overlaps(span, { start: frame, end: frame + 1 }));
      const box = pass.boxes[frame];
      const coverage = box
        ? Math.min(box.width / pass.analysisSize.width, box.height / pass.analysisSize.height)
        : 1;
      if (!dark && box && coverage < minCoverage) {
        if (runStart < 0) runStart = frame;
        runCoverage = Math.min(runCoverage, coverage);
        worst = Math.min(worst, coverage);
      } else flush(frame);
    }
    flush(Math.min(clip.span.end, pass.frames));
  }
  return checkResult(
    'blackBars',
    findings.length > 0 ? 'warn' : 'pass',
    {
      measured: { value: Math.round(worst * 1000) / 1000, unit: 'ratio' },
      threshold: { min: minCoverage, unit: 'ratio' },
      findings,
      fixes: uniqueFixes(fixes),
    },
    0,
  );
}
