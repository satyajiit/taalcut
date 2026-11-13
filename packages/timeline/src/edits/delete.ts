// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.deleteClip (EDT1-OPS, SPEC "EDT1-OPS: structure"): a clip or gap on V1 goes, with the transitions on its
 * cuts. `ripple` is the gap fix's drop (gaps/drop-slot.ts): what follows moves earlier by its length, every later
 * cut re-syncs to the beat grid and takes the anchor of its new start, and text, markers, captions and the audio
 * tracks follow one time map. `lift` leaves a gap of the same length and slot in its place, so nothing moves. Either
 * way its cast slot keeps the pick with note `dropped` and `clipId: null`.
 */
import { err, ok, type Result, type SequenceItem, type Timeline, type TimelineItemId } from '@taalcut/core';
import { ItemNotFound } from '../errors';
import { dropSlot } from '../gaps/drop-slot';
import { updateSlots } from '../model/cast';
import { findPosition, videoItems, withVideoItems } from '../model/sequence';
import { refuseLocked, unchanged, type EditOptions, type EditResult } from './types';

export function deleteClip(
  timeline: Timeline,
  input: { readonly clipId: TimelineItemId; readonly mode: 'ripple' | 'lift' },
  options: EditOptions & { readonly ids: () => TimelineItemId },
): Result<EditResult> {
  if (input.mode === 'ripple') return dropSlot(timeline, { itemId: input.clipId, mode: 'ripple' }, options);
  const position = findPosition(timeline, input.clipId);
  if (!position) return err(ItemNotFound({ itemId: input.clipId }));
  const clip = position.item;
  if (clip.type === 'gap') return unchanged(timeline);
  const allowed = refuseLocked(clip, options.source);
  if (!allowed.ok) return allowed;
  const items = videoItems(timeline).flatMap((item, index): SequenceItem[] => {
    if (index === position.itemIndex)
      return [{ type: 'gap', id: clip.id, duration: clip.duration, slotId: clip.slotId }];
    // A transition can't sit beside a gap.
    const touches = index === position.itemIndex - 1 || index === position.itemIndex + 1;
    return touches && item.type === 'transition' ? [] : [item];
  });
  const cast = updateSlots(timeline.cast, (slot) =>
    slot.clipId === clip.id ? { ...slot, clipId: null, note: 'dropped' } : slot,
  );
  return ok({ timeline: withVideoItems({ ...timeline, cast }, items), changed: ['tracks', 'cast'] });
}
