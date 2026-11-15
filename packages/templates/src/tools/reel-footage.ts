// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * KEEP1: the Analyst's statement that a slot is the reel's own footage (core's slot-footage.ts), as the tools hold
 * it. The model states it; nothing here reads a frame or a word to decide it. What the tools check is what they can
 * know for certain:
 *
 * - The reel can be kept. A statement is honoured only when templates.finalise will have a file to keep as the
 *   template's media (keep-media.ts). When it won't, the slot is stored as a slot for the person's clips and the
 *   answer says so: the mend is mechanical, and a refusal would only cost the page's turn (as AGT1 found for intents).
 * - A slot is left for the person. A template whose every slot is the reel's own is the reel again, with nothing of
 *   the person's in it: templates.setIntents warns once the last page is stored, and templates.finalise refuses.
 */
import { SLOT_FOOTAGE_REASON_CHARS, type TemplateMediaStore } from '@taalcut/core';
import type { SlotIntentInput } from '../breakdown/build-template';
import type { BreakdownDraft } from '../breakdown/draft';
import { keepInputFor } from './keep-media';

/** The entry's footage, as templates.setIntents takes it. */
export interface FootageEntry {
  readonly from: 'person' | 'reel';
  readonly reason?: string | undefined;
}

/** The reason at the store's length, cut at a word. */
export function reelReason(reason: string | undefined): string | null {
  const text = reason?.trim() ?? '';
  if (text.length === 0) return null;
  if (text.length <= SLOT_FOOTAGE_REASON_CHARS) return text;
  const cut = text.slice(0, SLOT_FOOTAGE_REASON_CHARS);
  const space = cut.lastIndexOf(' ');
  return (space > SLOT_FOOTAGE_REASON_CHARS / 2 ? cut.slice(0, space) : cut).trim();
}

/** Whether templates.finalise will have this breakdown's reel to keep as the template's media. */
export async function reelKeepable(
  media: TemplateMediaStore | undefined,
  draft: BreakdownDraft,
  dir: string,
): Promise<boolean> {
  return media !== undefined && (await keepInputFor(draft, dir)) !== null;
}

/** The stored statement of an entry: the reel's own footage with its reason, or none. */
export function statedReel(footage: FootageEntry | undefined): SlotIntentInput['keepsReel'] {
  return footage?.from === 'reel' ? { reason: reelReason(footage.reason) } : undefined;
}

/** Told when a page stated the reel's footage for slots whose reel can't be kept. */
export function unkeptNote(slots: readonly number[]): string {
  return (
    `Slots ${slots.join(', ')} can't keep the reel's own footage: this reel's video isn't kept on this Mac. ` +
    "They are stored as slots for the user's clips; tell the user."
  );
}

/** Told when every slot of the breakdown is stored as the reel's own footage. */
export const ALL_REEL_NOTE =
  "Every slot is stored as the reel's own footage, which leaves none for the user's clips, and " +
  'templates.finalise refuses that. Send again each slot the user\'s clips go in, with footage {"from": "person"}.';

/** templates.finalise's refusal when no slot is left for the person's clips. */
export const ALL_REEL_REFUSAL =
  "Every slot is stated as the reel's own footage, so a video made from this template would be the reel again, " +
  "with nothing of the user's. The reel's own footage is only what every video in this format keeps as it is (a " +
  "film scene, a meme clip); the slots the user's clips replace are not. Call templates.setIntents again for " +
  'those slots with footage {"from": "person"}, then finalise.';

/** The slots stored as the reel's own footage, by slot index. */
export function reelSlotsOf(intents: readonly SlotIntentInput[]): number[] {
  return intents.filter((item) => item.keepsReel).map((item) => item.slotIndex);
}
