// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.insertClip and timeline.duplicateClip (EDT1-OPS, SPEC "EDT1-OPS: structure"): a new clip goes in at a
 * cut of V1 and what follows moves later by its length (a ripple). A time inside a clip splits it there (split.ts);
 * a transition on that cut goes, since the cut is now two. Then the beats: the new clip's end and every later cut
 * are free to re-sync (each to the grid point nearest it that fits, as a trim's moved cut), and the new clip and
 * those after it take the anchor of their start, so a template's beat grid holds. Text, graphics, markers, captions,
 * voice lines and effects move with the video (insert-extras.ts); the music stays, its beats being the grid.
 */
import {
  err,
  ok,
  RationalTime,
  type Clip,
  type InsertPosition,
  type Result,
  type SequenceItem,
  type Timeline,
  type TimelineItemId,
} from '@taalcut/core';
import { InvalidMove, ItemNotFound } from '../errors';
import { EDIT_CONFIG } from '../model/config';
import { positions, sequenceLength, videoItems, withVideoItems } from '../model/sequence';
import { resync } from '../resync/resync';
import { insertExtras } from './insert-extras';
import { splitHalves } from './split';
import { clipPosition, refuseLocked, type EditOptions, type EditResult } from './types';

type Options = EditOptions & { readonly ids: () => TimelineItemId };
export type PlacedResult = EditResult & { readonly itemId: TimelineItemId };

/** V1 with the cut at position `boundary` free of its transition, and the item index a clip goes in at. */
function opened(items: readonly SequenceItem[], boundary: number): { items: SequenceItem[]; index: number } {
  const all = positions(items);
  const out = [...items];
  const next = all[boundary];
  if (!next) return { items: out, index: out.length };
  let index = next.itemIndex;
  if (out[index - 1]?.type === 'transition') {
    out.splice(index - 1, 1);
    index -= 1;
  }
  return { items: out, index };
}

/** Puts `clip` before position `boundary` (`positions.length`: at the end), ripples, and re-syncs what moved. */
export function placeClip(timeline: Timeline, clip: Clip, boundary: number, options: Options): Result<PlacedResult> {
  const all = positions(videoItems(timeline));
  const frame = all[boundary]?.start ?? sequenceLength(videoItems(timeline));
  const { items, index } = opened(videoItems(timeline), boundary);
  items.splice(index, 0, clip);
  const moved = insertExtras(withVideoItems(timeline, items), frame, clip.duration.value, options.ids);
  const count = positions(items).length;
  const after = Array.from({ length: count - boundary }, (_, offset) => boundary + 1 + offset);
  const synced = resync(moved, {
    moved: after,
    reanchor: [boundary, ...after],
    ids: options.ids,
    ...(options.config ? { config: options.config } : {}),
  });
  return ok({ timeline: synced, changed: ['tracks', 'markers', 'captions'], itemId: clip.id });
}

/** Position index of a V1 item, or ItemNotFound. */
function indexOf(timeline: Timeline, itemId: string): Result<number> {
  const index = positions(videoItems(timeline)).findIndex((position) => position.item.id === itemId);
  return index < 0 ? err(ItemNotFound({ itemId })) : ok(index);
}

/**
 * Where the position puts a clip: the boundary to insert at, on `timeline` (split first when a time falls inside a
 * clip, at least minClipFrames from both its ends; nearer one, the clip's nearer edge).
 */
export function insertionPoint(
  timeline: Timeline,
  position: InsertPosition,
  options: Options,
): Result<{ readonly timeline: Timeline; readonly boundary: number }> {
  const all = positions(videoItems(timeline));
  switch (position.kind) {
    case 'before':
    case 'after': {
      const index = indexOf(timeline, position.itemId);
      if (!index.ok) return index;
      return ok({ timeline, boundary: index.value + (position.kind === 'after' ? 1 : 0) });
    }
    case 'slot': {
      const index = all.findIndex((entry) => entry.item.slotId === position.slotId);
      if (index < 0) return err(ItemNotFound({ itemId: position.slotId }));
      return ok({ timeline, boundary: index });
    }
    case 'time': {
      const frame = RationalTime.rescale(position.at, timeline.canvas.rate, 'round').value;
      if (frame < 0) return err(InvalidMove(undefined, { detail: 'Before the video starts' }));
      const index = all.findIndex((entry) => frame >= entry.start && frame < entry.end);
      const found = all[index];
      if (!found) return ok({ timeline, boundary: all.length });
      const min = (options.config ?? EDIT_CONFIG).minClipFrames;
      const offset = frame - found.start;
      const inside = offset >= min && found.end - frame >= min;
      if (!inside || found.item.type !== 'clip')
        return ok({ timeline, boundary: offset * 2 < found.end - found.start ? index : index + 1 });
      const allowed = refuseLocked(found.item, options.source);
      if (!allowed.ok) return allowed;
      const halves = splitHalves(timeline, found.item, found.start, offset, options.ids());
      const items = [...videoItems(timeline)];
      items.splice(found.itemIndex, 1, ...halves);
      return ok({ timeline: withVideoItems(timeline, items), boundary: index + 1 });
    }
  }
}

export function insertClip(
  timeline: Timeline,
  input: { readonly clip: Clip; readonly position: InsertPosition },
  options: Options,
): Result<PlacedResult> {
  if (input.clip.duration.value < 1) return err(InvalidMove(undefined, { detail: 'A clip lasts at least a frame' }));
  const point = insertionPoint(timeline, input.position, options);
  if (!point.ok) return point;
  return placeClip(point.value.timeline, input.clip, point.value.boundary, options);
}

/** A copy of the clip right after it: a new id, no slot, unlocked. */
export function duplicateClip(
  timeline: Timeline,
  input: { readonly clipId: TimelineItemId },
  options: Options,
): Result<PlacedResult> {
  const found = clipPosition(timeline, input.clipId, options.source);
  if (!found.ok) return found;
  const copy: Clip = { ...found.value.item, id: options.ids(), slotId: null, locked: false };
  const index = positions(videoItems(timeline)).findIndex((entry) => entry.item.id === input.clipId);
  return placeClip(timeline, copy, index + 1, options);
}
