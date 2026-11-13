// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Transitions and speed ramps (SPEC "Transitions", "Speed ramps"). A soft
 * cut's ramp becomes the next slot's `transitionIn`: a fade when luma dips to
 * black or white across it, a whip when motion peaks, otherwise a dissolve;
 * below `transition.keep` confidence it stays a plain cut. A sustained 2×
 * change of median motion inside a shot, confirmed by the frame-difference
 * rate, becomes a two-point ramp. (Cut order item 2: both may ship as plain
 * cuts, so every input here is optional.)
 */
import type { BreakdownConfig } from './config';

export interface TransitionGuess {
  readonly kind: 'dissolve' | 'fade' | 'whip';
  /** Frames before and after the cut the transition covers. */
  readonly before: number;
  readonly after: number;
  readonly confidence: number;
}

export interface FrameValue {
  readonly frame: number;
  readonly value: number;
}

const inRange = (values: readonly FrameValue[], start: number, end: number) =>
  values.filter((item) => item.frame >= start && item.frame <= end);

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * The transition for a soft cut at `frame` whose ramp runs `start`–`end`.
 * `distance` is method B's jump, which sets the confidence. Null keeps a cut.
 */
export function classifyTransition(
  cut: { readonly frame: number; readonly start: number; readonly end: number; readonly distance: number },
  signals: { readonly luma?: readonly FrameValue[]; readonly motion?: readonly FrameValue[] },
  config: Pick<BreakdownConfig, 'transition' | 'embed'>,
): TransitionGuess | null {
  const length = cut.end - cut.start + 1;
  // One or two frames of change is a cut, not a transition.
  if (length < 3) return null;
  const confidence = Math.min(1, cut.distance / Math.max(config.embed.strong, 1e-6));
  if (confidence < config.transition.keep) return null;
  const before = Math.max(0, cut.frame - cut.start);
  const after = Math.max(1, cut.end - cut.frame + 1);
  const luma = inRange(signals.luma ?? [], cut.start, cut.end).map((item) => item.value);
  if (
    luma.length > 0 &&
    (Math.min(...luma) <= config.transition.fadeLuma || Math.max(...luma) >= config.transition.flashLuma)
  )
    return { kind: 'fade', before, after, confidence };
  const motion = signals.motion ?? [];
  if (motion.length > 0) {
    const around = Math.max(...inRange(motion, cut.start, cut.end).map((item) => item.value), 0);
    const typical = median(motion.map((item) => item.value));
    if (typical > 0 && around >= config.transition.whipMotion * typical)
      return { kind: 'whip', before, after, confidence };
  }
  return { kind: 'dissolve', before, after, confidence };
}

export interface RampGuess {
  /** Frames from the slot's start. */
  readonly points: readonly { readonly at: number; readonly speed: number }[];
  readonly confidence: number;
}

/**
 * A speed ramp inside one shot [start, end): the split point where median
 * motion after vs before changes by at least `minRatio`, both sides at least
 * `windowSeconds` long, and the frame-difference rate (`diff`, e.g. scdet's
 * per-frame score) agreeing by `confirmRatio`. Null when unsure.
 */
export function detectSpeedRamp(
  shot: { readonly start: number; readonly end: number },
  motion: readonly FrameValue[],
  diff: readonly FrameValue[],
  fps: number,
  config: BreakdownConfig['ramp'],
): RampGuess | null {
  const length = shot.end - shot.start;
  const window = Math.round(config.windowSeconds * fps);
  if (length < config.minSlotSeconds * fps || length < 2 * window) return null;
  const inside = inRange(motion, shot.start, shot.end - 1);
  let best: { at: number; ratio: number; strength: number; spread: number } | null = null;
  // Candidate split points are the motion samples themselves (10 a second away from cuts).
  for (const { frame: split } of inside) {
    if (split < shot.start + window || split > shot.end - window) continue;
    const left = inRange(inside, shot.start, split - 1).map((item) => item.value);
    const right = inRange(inside, split, shot.end - 1).map((item) => item.value);
    const before = median(left);
    const after = median(right);
    if (before <= 0 || after <= 0) continue;
    const ratio = after / before;
    const strength = Math.round(Math.max(ratio, 1 / ratio) * 100) / 100;
    // Medians tie over a range of splits; the true change point leaves each side closest to its median.
    const spread =
      left.reduce((sum, value) => sum + Math.abs(value - before), 0) +
      right.reduce((sum, value) => sum + Math.abs(value - after), 0);
    if (
      strength >= config.minRatio &&
      (!best || strength > best.strength || (strength === best.strength && spread < best.spread))
    )
      best = { at: split, ratio, strength, spread };
  }
  if (!best) return null;
  const diffBefore = median(inRange(diff, shot.start, best.at - 1).map((item) => item.value));
  const diffAfter = median(inRange(diff, best.at, shot.end - 1).map((item) => item.value));
  const agrees =
    best.ratio > 1
      ? diffAfter >= config.confirmRatio * diffBefore
      : diffBefore >= config.confirmRatio * diffAfter;
  if (!agrees || diffBefore <= 0 || diffAfter <= 0) return null;
  const speed = Math.min(16, Math.max(0.1, Math.round(best.ratio * 100) / 100));
  return {
    points: [
      { at: 0, speed: 1 },
      { at: best.at - shot.start, speed },
    ],
    confidence: Math.min(1, Math.max(best.ratio, 1 / best.ratio) / (2 * config.minRatio)),
  };
}
