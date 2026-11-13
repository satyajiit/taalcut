// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Slot provenance for export.completed (gate criterion 2): of the cast's
 * slots, how many still show the Librarian's pick, how many the user
 * swapped, and whether clips moved to other slots. It compares the exported
 * timeline with the assembly's result (the timeline's first saved version);
 * without that, it reads the cast's notes alone.
 */
import type { Timeline } from '@taalcut/core';
import { candidateKey, clipKey } from './cast';
import { videoItems } from './sequence';

export interface SlotProvenance {
  readonly slots: number;
  /** Slots still showing the pick the Librarian made for them. */
  readonly slotsKeptAi: number;
  /** Slots the user filled with something the cast never picked for any slot. */
  readonly slotsSwappedByUser: number;
  /** A slot shows what the Librarian picked for another slot: the user reordered clips. */
  readonly orderChanged: boolean;
  /** The timeline uses an edited version of its template (the user changed the breakdown). */
  readonly breakdownEdited: boolean;
}

/** What each slot shows now, by slot id (null: a gap). */
function shownBySlot(timeline: Timeline): Map<string, string | null> {
  const clips = new Map(
    videoItems(timeline)
      .filter((item) => item.type === 'clip')
      .map((clip) => [clip.id as string, clipKey(clip)]),
  );
  return new Map(
    (timeline.cast?.slots ?? []).map((slot) => [
      slot.slotId as string,
      slot.clipId ? (clips.get(slot.clipId) ?? null) : null,
    ]),
  );
}

/** The Librarian's pick for each slot, by slot id. */
function aiPicks(assembled: Timeline | null, exported: Timeline): Map<string, string | null> {
  const source = assembled?.cast ?? null;
  if (source)
    return new Map(
      source.slots.map((slot) => [slot.slotId as string, slot.pick ? candidateKey(slot.pick) : null]),
    );
  // No assembly to compare with: a slot the user never touched still has its pick.
  return new Map(
    (exported.cast?.slots ?? []).map((slot) => [
      slot.slotId as string,
      slot.note === 'userPick' || !slot.pick ? null : candidateKey(slot.pick),
    ]),
  );
}

export function slotProvenance(assembled: Timeline | null, exported: Timeline): SlotProvenance {
  const cast = exported.cast;
  // A template's first version is the Analyst's (or the format's); every edit makes a new one.
  const breakdownEdited = (exported.template?.version ?? 1) > 1;
  if (!cast) return { slots: 0, slotsKeptAi: 0, slotsSwappedByUser: 0, orderChanged: false, breakdownEdited };
  const shown = shownBySlot(exported);
  const picks = aiPicks(assembled, exported);
  const pickedFor = new Map<string, string>();
  for (const [slotId, key] of picks) if (key) pickedFor.set(key, slotId);
  let kept = 0;
  let swapped = 0;
  let moved = false;
  for (const slot of cast.slots) {
    const key = shown.get(slot.slotId) ?? null;
    const own = picks.get(slot.slotId) ?? null;
    if (key !== null && key === own) kept++;
    else if (key !== null && pickedFor.has(key)) moved = true;
    else if (slot.note === 'userPick') swapped++;
  }
  return {
    slots: cast.slots.length,
    slotsKeptAi: kept,
    slotsSwappedByUser: swapped,
    orderChanged: moved,
    breakdownEdited,
  };
}
