// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.moveClip (SPEC, pending PO confirmation): clips change places but
 * the positions stay put. A position keeps its length, slot, beat anchor and
 * ramp; the content moving in keeps its id and media, and its in-point is
 * chosen again around its sync point. No cut moves, so nothing re-snaps.
 */
import {
  err,
  ok,
  RationalTime,
  TimeRange,
  type Clip,
  type Gap,
  type Result,
  type SlotCast,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { InvalidMove, MediaTooShort } from '../errors';
import { toMedia } from '../model/clip-edit';
import { medianItemFrames, positions, videoItems, withVideoItems, type Filler, type Position } from '../model/sequence';
import { clipMediaFits, consumedMedia, sourceFrames } from '../model/speed';
import { anchorAt, anchorFrame, beatGrid, type BeatGrid } from '../resync/grid';
import { resync } from '../resync/resync';
import { clipPosition, refuseLocked, unchanged, type EditOptions, type EditResult } from './types';

export interface MoveInput {
  readonly clipId: TimelineItemId;
  /** The position (clip or gap on V1, transitions not counted) the clip moves to. */
  readonly toIndex: number;
}

/** The in-point that puts the sync point on the anchor, else the old one, pulled back in if the end runs out. */
function placeInPoint(clip: Clip, start: number, grid: BeatGrid, timeline: Timeline): Clip | null {
  if (clip.media.kind === 'image') return clip;
  const rate = timeline.canvas.rate;
  let sourceStart = clip.sourceStart;
  const landed = clip.beatAnchor ? anchorFrame(grid, clip.beatAnchor) : null;
  if (clip.syncPoint && landed !== null) {
    // The ramp's integral up to the anchor, as trimStart measures it.
    const lead = toMedia(Math.round(sourceFrames(clip.speed, landed - start)), rate, clip.syncPoint.rate);
    sourceStart = RationalTime.subtract(clip.syncPoint, lead);
  }
  const placed = { ...clip, sourceStart };
  if (clipMediaFits(placed, rate)) return placed;
  const { available } = clip.media;
  const used = consumedMedia(placed, available.start.rate, rate);
  const latest = RationalTime.rescale(
    RationalTime.subtract(TimeRange.end(available), used),
    available.start.rate,
    'floor',
  );
  const pulled = { ...placed, sourceStart: RationalTime.max(available.start, latest), syncPoint: null };
  return clipMediaFits(pulled, rate) ? pulled : null;
}

/** `content` at `position`: the position's length, slot, anchor and ramp; the content's id and media. */
function fill(content: Filler, position: Position, grid: BeatGrid, timeline: Timeline): Filler | null {
  const at = position.item;
  if (content.type === 'gap') {
    const gap: Gap = { type: 'gap', id: content.id, duration: at.duration, slotId: at.slotId };
    return gap;
  }
  if (content.type === 'program') return { ...content, duration: at.duration };
  const moved: Clip = {
    ...content,
    duration: at.duration,
    slotId: at.slotId,
    beatAnchor: at.type === 'clip' ? at.beatAnchor : anchorAt(grid, position.start, timeline.canvas.rate),
    speed: at.type === 'clip' ? at.speed : null,
  };
  return placeInPoint(moved, position.start, grid, timeline);
}

export function moveClip(timeline: Timeline, input: MoveInput, options: EditOptions): Result<EditResult> {
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  const items = [...videoItems(timeline)];
  const all = positions(items);
  const from = all.findIndex((position) => position.item.id === input.clipId);
  if (input.toIndex >= all.length) return err(InvalidMove(undefined, { detail: 'No such position' }));
  if (from === input.toIndex) return unchanged(timeline);

  const contents = all.map((position) => position.item);
  const [moving] = contents.splice(from, 1);
  contents.splice(input.toIndex, 0, moving as Filler);
  const grid = beatGrid(timeline.beatMap, timeline.canvas.rate, medianItemFrames(items));
  for (let index = 0; index < all.length; index++) {
    const position = all[index] as Position;
    const content = contents[index] as Filler;
    if (content === position.item) continue;
    const allowed = refuseLocked(content, options.source);
    if (!allowed.ok) return allowed;
    const filled = fill(content, position, grid, timeline);
    if (!filled) return err(MediaTooShort({ clipId: content.id }));
    items[position.itemIndex] = filled;
  }

  const cast = timeline.cast;
  let nextCast = cast;
  if (cast) {
    const picks = new Map(cast.slots.filter((slot) => slot.clipId).map((slot) => [slot.clipId, slot.pick]));
    const bySlot = new Map(
      positions(items)
        .filter((position) => position.item.slotId !== null)
        .map((position) => [position.item.slotId, position.item.type === 'clip' ? position.item.id : null]),
    );
    const slots = cast.slots.map((slot): SlotCast => {
      const clipId = bySlot.has(slot.slotId) ? (bySlot.get(slot.slotId) ?? null) : slot.clipId;
      if (clipId === slot.clipId) return slot;
      return {
        ...slot,
        clipId,
        pick: clipId ? (picks.get(clipId) ?? null) : null,
        confidence: null,
        needsRerank: false,
        note: options.source === 'agent' ? null : 'userPick',
      };
    });
    nextCast = { ...cast, slots };
  }
  const edited = withVideoItems({ ...timeline, cast: nextCast }, items);
  const synced = resync(edited, { before: timeline, ...(options.config ? { config: options.config } : {}) });
  return ok({ timeline: synced, changed: ['tracks', 'markers', 'cast'] });
}
