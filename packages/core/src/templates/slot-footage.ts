// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: whose footage a template slot plays in a video made from the template. A reel can hold footage that is the
 * format's fixed part (a film scene, a meme clip): a video made from it keeps that footage, cut from the reel the
 * template keeps on this Mac (REF1, templateMediaSchema), and the person's clips go only in the other slots.
 *
 * The statement is data on the slot (`footage`). The Analyst states it when it writes the slot's intent, from the
 * slot's frames, what is said and shown, and the person's request; the person can change it per slot in the breakdown
 * review (`template.slot.setFootage`). No code decides it from what a shot looks like. Tools act on it: casting
 * never asks the library for a reel slot, assembly fills it from the template's media at the slot's frame range, and
 * the gap check never counts it as empty.
 *
 * Absent on a slot: the person's footage, as every template before KEEP1, so stored documents read unchanged.
 */
import '../basics/zod-config';
import { z } from 'zod';

/** `person`: the slot is cast from the person's library. `reel`: it keeps the reel's own footage. */
export const SLOT_FOOTAGE_SOURCES = ['person', 'reel'] as const;
export type SlotFootageSource = (typeof SLOT_FOOTAGE_SOURCES)[number];

/** Who stated it: the Analyst when it wrote the intents, or the person in the review. */
export const SLOT_FOOTAGE_AUTHORS = ['analyst', 'user'] as const;
export type SlotFootageAuthor = (typeof SLOT_FOOTAGE_AUTHORS)[number];

export const SLOT_FOOTAGE_REASON_CHARS = 160;

export const slotFootageSchema = z.object({
  from: z.enum(SLOT_FOOTAGE_SOURCES),
  by: z.enum(SLOT_FOOTAGE_AUTHORS),
  /**
   * Why the slot is the reel's own footage, in one short line the person can read ("A film scene the joke lands
   * on"). Plain text, written from someone else's video: shown as text only. Null when nobody gave one. A person's
   * change keeps the Analyst's line, so the review still says why Taalcut read it that way.
   */
  reason: z.string().trim().min(1).max(SLOT_FOOTAGE_REASON_CHARS).nullable(),
});
export type SlotFootage = z.output<typeof slotFootageSchema>;

/** Whether a video made from the template keeps the reel's own footage in this slot. */
export function keepsReelFootage(slot: { readonly footage?: SlotFootage | undefined }): boolean {
  return slot.footage?.from === 'reel';
}
