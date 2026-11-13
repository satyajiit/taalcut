// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A tween's `keyframes`, unrolled into the tweens GSAP makes of them (HFW1 lower; gsap-core 3.15's Tween):
 * - an array of frames plays them one after another, each its own duration (GSAP's 0.5 s when none), ease "none"
 *   unless the frame sets one;
 * - percentages (`{ "0%": {...}, "50%": {...} }`) and value arrays (`{ x: [0, 100, 50] }`, evenly spaced) become, for
 *   each property, one tween from each of its keyframes to the next over that share of the duration, eased by the
 *   keyframe's own ease, else `easeEach`, else power1.inOut; a 0% keyframe is a jump at the start.
 * GSAP eases the whole sequence by the tween's ease (or `keyframes.ease`) on top of that; only "none" unrolls, so any
 * other is refused. HyperFrames' parser reads the frames into percentages of the tween's length, rounded to 0.1%;
 * an array's frames are timed by their own durations, read from the script (`frameDurations`), so a frame lands
 * where GSAP lands it and not up to a millisecond off.
 */
import type { GsapKeyframesData } from '@hyperframes/parsers/gsap-parser';
import type { Node } from './statements';

/** One unrolled step: seconds from the tween's start, its length, ease and values. */
export interface KeyframeStep {
  readonly offset: number;
  readonly duration: number;
  readonly ease: string;
  readonly properties: Readonly<Record<string, number | string>>;
}

const LINEAR = new Set(['none', 'linear', 'power0', 'power0.in', 'power0.out', 'power0.inOut']);

export const isLinearEase = (ease: string | undefined): boolean => ease === undefined || LINEAR.has(ease);

const round = (value: number) => Math.round(value * 1e7) / 1e7 || 0;

/** GSAP's default duration, a frame's length when it sets none. */
const FRAME_DURATION = 0.5;

/** The lengths of an array of keyframes as the script writes them (seconds), when every one is a plain number. */
export function frameDurations(vars: Node | undefined): number[] | undefined {
  if (vars?.type !== 'ObjectExpression') return undefined;
  const key = (property: Node) =>
    (property.key as Node | undefined)?.name ?? (property.key as Node | undefined)?.value;
  const list = (vars.properties as Node[]).find((property) => key(property) === 'keyframes')?.value as
    Node | undefined;
  if (list?.type !== 'ArrayExpression') return undefined;
  const lengths: number[] = [];
  for (const frame of list.elements as (Node | null)[]) {
    if (frame?.type !== 'ObjectExpression') return undefined;
    const written = (frame.properties as Node[]).find((property) => key(property) === 'duration')?.value as
      Node | undefined;
    if (written && (written.type !== 'Literal' || typeof written.value !== 'number')) return undefined;
    lengths.push(written ? (written.value as number) : FRAME_DURATION);
  }
  return lengths;
}

/** The steps of a tween's keyframes over its `duration` (seconds), or why they don't unroll. */
export function unrollKeyframes(
  data: GsapKeyframesData,
  duration: number,
  lengths?: readonly number[],
): KeyframeStep[] | string {
  if (data.keyframes.length === 0) return 'has no keyframes';
  if (!isLinearEase(data.ease)) return `eases the keyframes as a whole (${data.ease ?? ''})`;
  const at = (percentage: number) => round((percentage / 100) * duration);
  if (data.format === 'object-array') {
    const exact = lengths?.length === data.keyframes.length ? lengths : undefined;
    const steps: KeyframeStep[] = [];
    let previous = 0;
    let offset = 0;
    data.keyframes.forEach((frame, index) => {
      const length = exact?.[index] ?? at(frame.percentage) - at(previous);
      steps.push({
        offset: round(offset),
        duration: round(length),
        ease: frame.ease ?? 'none',
        properties: frame.properties,
      });
      offset += length;
      previous = frame.percentage;
    });
    return data.keyframes.some((frame) => 'delay' in frame.properties) ? 'gives a frame a delay' : steps;
  }
  const byProperty = new Map<string, { t: number; v: number | string; e: string }[]>();
  for (const frame of data.keyframes)
    for (const [property, value] of Object.entries(frame.properties)) {
      if (property === 'delay' || property === 'duration') return `sets ${property} in a keyframe`;
      const list = byProperty.get(property) ?? [];
      list.push({ t: frame.percentage, v: value, e: frame.ease ?? data.easeEach ?? 'power1.inOut' });
      byProperty.set(property, list);
    }
  const steps: KeyframeStep[] = [];
  for (const [property, list] of byProperty) {
    const sorted = [...list].sort((a, b) => a.t - b.t);
    sorted.forEach((keyframe, index) => {
      const from = index === 0 ? 0 : (sorted[index - 1]?.t ?? 0);
      steps.push({
        offset: at(from),
        duration: round(at(keyframe.t) - at(from)),
        ease: keyframe.e,
        properties: { [property]: keyframe.v },
      });
    });
  }
  return steps;
}
