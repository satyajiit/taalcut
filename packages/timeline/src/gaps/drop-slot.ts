// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.dropSlot (P3-B8): a clip or gap on V1 goes, with the transitions on its cuts.
 * - `ripple`: everything after moves earlier by its length (slots are beat-long, so the following cuts stay on
 *   beats), then re-sync: moved cuts snap to the grid and take the anchor of their new start; text, markers,
 *   caption cues and the audio tracks follow through one time map.
 * - `extendPrevious`: the clip before takes the time (rolling its end over its media), else the clip after
 *   (rolling its start back), else it ripples. Nothing else moves.
 * The cast slot keeps its pick and alternates with note `dropped` and `clipId: null`.
 */
import { err, ok, type CommandSource, type Result, type SequenceItem, type Timeline, type TimelineItemId } from '@taalcut/core';
import { rippleExtras } from '../edits/ripple';
import { timeMap } from '../edits/time-map';
import { refuseLocked, type EditOptions, type EditResult } from '../edits/types';
import { InvalidMove, ItemNotFound } from '../errors';
import { trimEnd, trimStart } from '../model/clip-edit';
import { updateSlots } from '../model/cast';
import { findPosition, positions, videoItems, withVideoItems, type Filler, type Position } from '../model/sequence';
import { clipMediaFits } from '../model/speed';
import { resync } from '../resync/resync';

export type DropMode = 'ripple' | 'extendPrevious';

/** V1 without the item and the transitions on either side of it. */
function without(items: readonly SequenceItem[], index: number): SequenceItem[] {
  return items.filter((item, at) => {
    if (at === index) return false;
    const touches = at === index - 1 || at === index + 1;
    return !(touches && item.type === 'transition');
  });
}

function fits(item: Filler, timeline: Timeline): boolean {
  return item.type === 'gap' || (item.type === 'clip' && clipMediaFits(item, timeline.canvas.rate));
}

/** The neighbour that can take the dropped frames, as the new V1; null when neither can. */
function extended(timeline: Timeline, position: Position, source: CommandSource): SequenceItem[] | null {
  const items = videoItems(timeline);
  const all = positions(items);
  const at = all.findIndex((entry) => entry.item.id === position.item.id);
  const frames = position.end - position.start;
  const rate = timeline.canvas.rate;
  const previous = all[at - 1];
  const next = all[at + 1];
  const candidates: [Position | undefined, (item: Filler) => Filler][] = [
    [previous, (item) => trimEnd(item, frames, rate)],
    [next, (item) => trimStart(item, -frames, rate)],
  ];
  for (const [neighbour, grow] of candidates) {
    if (!neighbour || neighbour.item.type !== 'clip') continue;
    if (!refuseLocked(neighbour.item, source).ok) continue;
    const grown = grow(neighbour.item);
    if (!fits(grown, timeline)) continue;
    const out = [...items];
    out[neighbour.itemIndex] = grown;
    return without(out, position.itemIndex);
  }
  return null;
}

function droppedCast(timeline: Timeline, item: Filler): Timeline['cast'] {
  return updateSlots(timeline.cast, (slot) =>
    slot.slotId === item.slotId || slot.clipId === item.id ? { ...slot, clipId: null, note: 'dropped' } : slot,
  );
}

export function dropSlot(
  timeline: Timeline,
  input: { readonly itemId: TimelineItemId; readonly mode: DropMode },
  options: EditOptions & { readonly ids: () => TimelineItemId },
): Result<EditResult> {
  const position = findPosition(timeline, input.itemId);
  if (!position) return err(ItemNotFound({ itemId: input.itemId }));
  const locked = refuseLocked(position.item, options.source);
  if (!locked.ok) return locked;
  const cast = droppedCast(timeline, position.item);
  if (input.mode === 'extendPrevious') {
    const items = extended(timeline, position, options.source);
    if (items) return ok({ timeline: withVideoItems({ ...timeline, cast }, items), changed: ['tracks', 'cast'] });
  }
  const items = without(videoItems(timeline), position.itemIndex);
  if (positions(items).length === 0) return err(InvalidMove(undefined, { detail: 'The video would be empty' }));
  const map = timeMap([{ start: position.start, end: position.end }]);
  const rippled = rippleExtras(withVideoItems({ ...timeline, cast }, items), map, options.ids);
  const at = positions(videoItems(timeline)).findIndex((entry) => entry.item.id === position.item.id);
  const count = positions(items).length;
  const moved = Array.from({ length: count - at + 1 }, (_, index) => at + index);
  const synced = resync(rippled, {
    moved,
    reanchor: moved,
    ids: options.ids,
    ...(options.config ? { config: options.config } : {}),
  });
  return ok({ timeline: synced, changed: ['tracks', 'markers', 'cast', 'captions'] });
}
