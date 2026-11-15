// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1: a moment of the footage that must land on a template slot's start or end for a video made from the
 * template to work: the action a cut or a transition hangs on (a hand reaches the switch as the shot ends, where the
 * reel dissolves into its next shot).
 *
 * The statement is data on the slot (`lands`). The Analyst states it when it writes the slot's intent, from the
 * slot's frames and the transition beside it, in words about what is seen that fit anyone's footage. No code reads
 * the words to find anything: the cast step looks at the person's clip, states the time the moment happens, and
 * casting puts that time on the slot's edge (timeline's landed moments), saying what it did.
 *
 * Absent on a slot: nothing has to land, as every template before MATCH1, so stored documents read unchanged.
 */
import '../basics/zod-config';
import { z } from 'zod';

/** The slot's edge the moment lands on: its first frame, or the cut (or the middle of the transition) that ends it. */
export const SLOT_EDGES = ['start', 'end'] as const;
export type SlotEdge = (typeof SLOT_EDGES)[number];

export const SLOT_MOMENT_CHARS = 160;

export const slotLandsSchema = z.object({
  edge: z.enum(SLOT_EDGES),
  /**
   * What is seen at that instant, in one short line. Plain text written from someone else's video: shown as text
   * only, and given to the cast step as data.
   */
  moment: z.string().trim().min(1).max(SLOT_MOMENT_CHARS),
});
export type SlotLands = z.output<typeof slotLandsSchema>;
