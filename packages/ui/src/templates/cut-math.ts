// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where a cut may go while the person moves it (BRK1-REV): strictly between the neighbouring cuts, a frame clear of
 * each, on a frame of the template's canvas, and onto a beat when the pointer comes near one. The command
 * (`template.slot.moveCut`) checks the same rules; these keep the preview honest about where it will land.
 */
import type { CutSnap, RationalTime, Template } from '@taalcut/core';
import { toSeconds } from './slot-words';

/** How near a beat the pointer must come, in pixels, before the cut snaps to it. */
export const BEAT_PULL_PX = 6;

export function frameSeconds(template: Template): number {
  const { num, den } = template.canvas.rate;
  return den / num;
}

/** The nearest frame of the canvas to `seconds`, as seconds. */
export function onFrame(template: Template, seconds: number): number {
  const frame = frameSeconds(template);
  return Math.round(seconds / frame) * frame;
}

/** The cut at `seconds`, as the commands take it: whole frames at the canvas rate. */
/** A cut's new place, as the commands take it (a RationalTime on the canvas's frames). */
export type CutTime = Pick<RationalTime, 'value' | 'rate'>;

export function cutTime(template: Template, seconds: number): CutTime {
  return { value: Math.round(seconds / frameSeconds(template)), rate: template.canvas.rate };
}

export function beatSeconds(template: Template): number[] {
  return template.beatMap?.beats.map(toSeconds) ?? [];
}

/** Where the cut at the start of slot `index` (1 or more) may go: a frame clear of its neighbours' other edges. */
export function cutRange(template: Template, index: number): { min: number; max: number } | null {
  const slot = template.slots[index];
  const before = template.slots[index - 1];
  if (!slot || !before) return null;
  const frame = frameSeconds(template);
  const min = toSeconds(before.start) + frame;
  const max = toSeconds(slot.start) + toSeconds(slot.duration) - frame;
  return max >= min ? { min, max } : null;
}

const clamp = (value: number, range: { min: number; max: number }) =>
  Math.min(range.max, Math.max(range.min, value));

export interface CutPlace {
  readonly seconds: number;
  readonly snap: CutSnap;
  /** The beat it sits on, from 1, when it snapped to one. */
  readonly beat: number | null;
}

/**
 * Where a pointer at `seconds` puts the cut before slot `index`: on a beat within BEAT_PULL_PX of it (unless
 * `free`, the Option key), else on the nearest frame, always inside the cut's range.
 */
export function placeCut(
  template: Template,
  index: number,
  seconds: number,
  pxPerSecond: number,
  free = false,
): CutPlace | null {
  const range = cutRange(template, index);
  if (!range) return null;
  if (!free && pxPerSecond > 0) {
    const beats = beatSeconds(template);
    let best = -1;
    for (let i = 0; i < beats.length; i += 1) {
      const beat = beats[i]!;
      if (beat < range.min || beat > range.max) continue;
      if (best < 0 || Math.abs(beat - seconds) < Math.abs(beats[best]! - seconds)) best = i;
    }
    if (best >= 0 && Math.abs(beats[best]! - seconds) * pxPerSecond <= BEAT_PULL_PX)
      return { seconds: onFrame(template, beats[best]!), snap: 'beat', beat: best + 1 };
  }
  return { seconds: clamp(onFrame(template, seconds), range), snap: 'frame', beat: null };
}

/** The cut nudged one frame, or to the next beat, left (−1) or right (+1), inside its range. */
export function nudgeCut(
  template: Template,
  index: number,
  seconds: number,
  direction: 1 | -1,
  by: CutSnap,
): CutPlace | null {
  const range = cutRange(template, index);
  if (!range) return null;
  if (by === 'beat') {
    const beats = beatSeconds(template);
    const frame = frameSeconds(template);
    const order =
      direction === 1 ? beats.map((b, i) => [b, i] as const) : beats.map((b, i) => [b, i] as const).reverse();
    for (const [beat, i] of order) {
      const ahead = direction === 1 ? beat > seconds + frame / 2 : beat < seconds - frame / 2;
      if (ahead && beat >= range.min && beat <= range.max)
        return { seconds: onFrame(template, beat), snap: 'beat', beat: i + 1 };
    }
    return { seconds: onFrame(template, seconds), snap: 'frame', beat: null };
  }
  const next = clamp(onFrame(template, seconds) + direction * frameSeconds(template), range);
  return { seconds: next, snap: 'frame', beat: null };
}

/** The slot index the time falls in (the last slot for the very end). */
export function slotAt(template: Template, seconds: number): number {
  const slots = template.slots;
  for (let i = slots.length - 1; i >= 0; i -= 1) if (toSeconds(slots[i]!.start) <= seconds + 1e-6) return i;
  return 0;
}
