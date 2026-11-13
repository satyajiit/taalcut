// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What follows a cut that moves or a slot that splits (BRK1-CMD). Merge and drop re-point what named a removed
 * slot to the slot that took its time; a moved or new cut changes which slot a moment falls in, so overlays and
 * contact-sheet tiles are re-pointed by their start instead, and each slot keeps a tile from inside it when it has
 * one. Ramps and transitions are trimmed to the lengths they now have.
 */
import {
  RationalTime,
  type FrameRate,
  type SpeedRamp,
  type Template,
  type TemplateSlot,
  type Transition,
} from '@taalcut/core';
import { computePacing } from './timing';

/** The slot a frame falls in: the last whose start is at or before it (slots tile the template in order). */
export function slotIndexAt(starts: readonly number[], frame: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid]! <= frame) low = mid;
    else high = mid - 1;
  }
  return low;
}

/** A ramp's points that still fit `length`, or none when fewer than two are left. */
export function fitRamp(ramp: SpeedRamp | null, length: RationalTime): SpeedRamp | null {
  if (!ramp) return null;
  const points = ramp.points.filter((point) => RationalTime.compare(point.at, length) <= 0);
  return points.length >= 2 ? { ...ramp, points } : null;
}

/** A transition no longer than the slots either side of its cut. */
export function fitTransition(
  transition: Transition | null,
  before: RationalTime,
  after: RationalTime,
): Transition | null {
  if (!transition) return null;
  return {
    ...transition,
    before: RationalTime.min(transition.before, before),
    after: RationalTime.min(transition.after, after),
  };
}

/** A cut the person placed. */
export const USER_CUT: TemplateSlot['cut'] = { method: 'user', confidence: 1 };

/** The slot's tile: kept while its moment is inside the slot, else the first tile inside it, else as it was. */
function tileFor(slot: TemplateSlot, tiles: readonly number[], start: number, end: number): number | null {
  const inside = (at: number | undefined) => at !== undefined && at >= start && at < end;
  if (slot.frame !== null && inside(tiles[slot.frame])) return slot.frame;
  const first = tiles.findIndex((at) => inside(at));
  return first >= 0 ? first : slot.frame;
}

/**
 * The template with `slots` after a cut moved or a slot split: overlays and tiles re-pointed by start time (those
 * in no slot stay so), each slot's tile refreshed and the pacing recomputed.
 */
export function retimed(template: Template, slots: readonly TemplateSlot[], rate: FrameRate): Template {
  const frames = (time: RationalTime) => RationalTime.toFrames(time, rate);
  const starts = slots.map((slot) => frames(slot.start));
  const owner = (time: RationalTime) => slots[slotIndexAt(starts, frames(time))]!.id;
  const sheet = template.contactSheet;
  const tiles = sheet ? sheet.frames.map((frame) => frames(frame.at)) : [];
  const placed = slots.map((slot, index) => {
    const end = starts[index]! + frames(slot.duration);
    return sheet ? { ...slot, frame: tileFor(slot, tiles, starts[index]!, end) } : slot;
  });
  return {
    ...template,
    slots: placed,
    text: template.text.map((item) => (item.slotId === null ? item : { ...item, slotId: owner(item.start) })),
    contactSheet: sheet
      ? {
          ...sheet,
          frames: sheet.frames.map((frame) =>
            frame.slotId === null ? frame : { ...frame, slotId: owner(frame.at) },
          ),
        }
      : null,
    pacing: computePacing(placed, template.beatMap, rate),
  };
}
