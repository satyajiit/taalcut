// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: `video.compare`'s judge, per slot. Each slot with a reel frame and a draft frame at some moment gets
 * one judge call with those pairs (slot-judge.ts), in the template's order, at most JUDGE_SLOTS_MAX a compare. It
 * runs only where the person's frames may go to a model (the judge sees the draft's), and says why not otherwise.
 */
import type { CompareSlot } from './compare-schema';
import type { Cut, PlannedSlot } from './compare-plan';
import type { EyesDeps } from './deps';
import type { FootagePicturesOut } from './pictures';
import type { SlotPair } from './slot-judge';

/** The most slots one compare judges: each is a model call. */
export const JUDGE_SLOTS_MAX = 8;

const picture = (data: Buffer) => ({ data: data.toString('base64'), mimeType: 'image/jpeg' as const });

export async function judgeSlots(
  deps: Pick<EyesDeps, 'judge'>,
  slots: readonly PlannedSlot[],
  cuts: readonly Cut[],
  pictures: FootagePicturesOut,
  signal?: AbortSignal,
): Promise<Map<string, NonNullable<CompareSlot['judged']>>> {
  const judged = new Map<string, NonNullable<CompareSlot['judged']>>();
  const judge = deps.judge;
  for (const [index, slot] of slots.entries()) {
    if (!judge) {
      judged.set(slot.slotId, 'No vision judge here: compare the pictures and the facts yourself.');
      continue;
    }
    if (pictures.footage !== 'shown') {
      judged.set(slot.slotId, `Not judged: ${pictures.why}`);
      continue;
    }
    if (index >= JUDGE_SLOTS_MAX) {
      judged.set(
        slot.slotId,
        `Not judged: at most ${JUDGE_SLOTS_MAX} slots a call. Ask for this one with judge again.`,
      );
      continue;
    }
    const pairs: SlotPair[] = cuts.flatMap((cut) =>
      cut.row.slotId === slot.slotId && cut.reel && cut.draft
        ? [{ moment: cut.row.moment, reel: picture(cut.reel), draft: picture(cut.draft) }]
        : [],
    );
    if (pairs.length === 0) {
      judged.set(slot.slotId, 'Not judged: no reel frame and draft frame to pair for this slot.');
      continue;
    }
    const verdict = await judge({ facts: slot.facts, pairs }, signal);
    judged.set(
      slot.slotId,
      verdict.ok
        ? {
            matches: verdict.value.matches,
            differences: [...verdict.value.differences],
            by: verdict.value.by,
          }
        : `Not judged: the judge failed (${verdict.error.code}).`,
    );
  }
  return judged;
}
