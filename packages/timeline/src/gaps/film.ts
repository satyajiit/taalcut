// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * timeline.markForFilming (P3-B8): slots the person will film themselves. Marked slots carry the cast note
 * `filmRequested` and join the phone's shot list; unmarking gives them back the note they'd have without it.
 */
import { err, ok, type Result, type SlotCast, type SlotId, type Timeline } from '@taalcut/core';
import type { EditResult } from '../edits/types';
import { ItemNotFound } from '../errors';

export function markForFilming(
  timeline: Timeline,
  input: { readonly slotIds: readonly SlotId[]; readonly on: boolean },
): Result<EditResult> {
  const cast = timeline.cast;
  const known = new Set((cast?.slots ?? []).map((slot) => slot.slotId as string));
  const missing = input.slotIds.find((slotId) => !known.has(slotId));
  if (!cast || missing) return err(ItemNotFound({ itemId: missing ?? input.slotIds[0] ?? 'cast' }));
  const wanted = new Set<string>(input.slotIds);
  let changed = false;
  const slots = cast.slots.map((slot): SlotCast => {
    if (!wanted.has(slot.slotId)) return slot;
    const note: SlotCast['note'] = input.on ? 'filmRequested' : slot.note === 'filmRequested' ? (slot.pick ? null : 'noCandidates') : slot.note;
    if (note === slot.note) return slot;
    changed = true;
    return { ...slot, note };
  });
  return ok({ timeline: { ...timeline, cast: { ...cast, slots } }, changed: changed ? ['cast'] : [] });
}
