// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: the draft against its template, slot by slot (checks/slot-match): needs, face, framing, camera move,
 * timing and the reel's graphics. The probe reads each reel graphic's box in the middle of its time. A render whose
 * timeline follows no template (or whose root can't read it) has no facts, and every slot check is skipped.
 */
import { SLOT_MATCH_CHECK_IDS, type QaCheckResult, type SlotMatchCheckId } from '@taalcut/core';
import {
  slotFaceCheck,
  slotFramingCheck,
  slotMotionCheck,
  slotNeedsCheck,
  slotTimingCheck,
} from '../checks/slot-match/slot-checks';
import { slotGraphicsCheck, type GraphicBoxAt } from '../checks/slot-match/slot-graphics';
import type { SlotMatchFact } from '../checks/slot-match/facts';
import { skipped } from '../result';
import type { QaCheckModule } from './module';

/** Every slot check on a draft's facts, in core's order; `boxAt` reads a graphic's box (null: none was read). */
export function slotMatchChecks(
  fact: SlotMatchFact,
  boxAt: GraphicBoxAt | null,
  ids: readonly SlotMatchCheckId[] = SLOT_MATCH_CHECK_IDS,
): QaCheckResult[] {
  const checks: Record<SlotMatchCheckId, () => QaCheckResult> = {
    slotNeeds: () => slotNeedsCheck(fact),
    slotFace: () => slotFaceCheck(fact),
    slotFraming: () => slotFramingCheck(fact),
    slotMotion: () => slotMotionCheck(fact),
    slotTiming: () => slotTimingCheck(fact),
    slotGraphics: () => slotGraphicsCheck(fact, boxAt),
  };
  return ids.map((id) => checks[id]());
}

export const slotMatchQaModule: QaCheckModule = {
  ids: SLOT_MATCH_CHECK_IDS,
  probeFrames: ({ facts }) =>
    (facts.slotMatch?.graphics ?? []).flatMap((graphic) => (graphic.hold !== null ? [graphic.hold] : [])),
  async run({ facts, probed }, wanted) {
    const ids = SLOT_MATCH_CHECK_IDS.filter((id) => wanted.has(id));
    const fact = facts.slotMatch;
    if (!fact) return ids.map((id) => skipped(id));
    const boxAt: GraphicBoxAt | null = probed
      ? (itemId, frame) =>
          probed.boxes.find((box) => box.kind === 'graphic' && box.id === itemId && box.frame === frame)
            ?.box ?? null
      : null;
    return slotMatchChecks(fact, boxAt, ids);
  },
};
