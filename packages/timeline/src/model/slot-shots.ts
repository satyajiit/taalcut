// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What each cast slot of a timeline shows, and which of those the user chose (a swap or move, cast note
 * `userPick`, or a locked clip): the Librarian's kept-picks check and the variants' locks and differences read
 * the same facts.
 */
import type { Timeline } from '@taalcut/core';
import { candidateKey, clipKey } from './cast';
import { positions, videoItems } from './sequence';

/** Slot id → key of the shot the user chose in `timeline`. */
export function userChoices(timeline: Timeline): Map<string, string> {
  const choices = new Map<string, string>();
  for (const slot of timeline.cast?.slots ?? [])
    if (slot.note === 'userPick' && slot.pick) choices.set(slot.slotId, candidateKey(slot.pick));
  for (const { item } of positions(videoItems(timeline))) {
    const key = item.type === 'clip' && item.locked && item.slotId ? clipKey(item) : null;
    if (key && item.slotId) choices.set(item.slotId, key);
  }
  return choices;
}

/** Slot id → key of what the slot shows now; null for a gap. In V1 order. */
export function shownBySlot(timeline: Timeline): Map<string, string | null> {
  const shown = new Map<string, string | null>();
  for (const { item } of positions(videoItems(timeline)))
    if (item.slotId) shown.set(item.slotId, item.type === 'clip' ? clipKey(item) : null);
  return shown;
}
