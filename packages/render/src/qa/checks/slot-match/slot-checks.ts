// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2-MATCH: a draft's slots against their template, one check per way a slot can differ (core's
 * SLOT_MATCH_CHECK_IDS; the graphics' is slot-graphics.ts). A check with a slot that misses warns: the person may
 * deliver a video that differs from its reel, and `video.done` holds the AI to it. Each missing slot is a finding
 * over its frames (its target its first clip, or the slot itself when no clip fills it), and the first five an agent
 * fix in QA's shape:
 * the slot's number and id, what differs and by how much, and the tools that can change it. A slot the facts can't
 * speak for (no stated face, no track, no measured move) is left out; a check with no slot to hold is skipped.
 */
import type { QaCheckId, QaCheckResult, QaFix } from '@taalcut/core';
import { CASTING_CONFIG } from '@taalcut/timeline';
import { agentFix, checkResult, skipped, type QaFinding, type QaUnit } from '../../result';
import { SLOT_MATCH, type ShareBox, type SlotFact, type SlotMatchFact } from './facts';

/** One slot's failure: its measure for the finding and its fix's params (slot, slotId and clipId are added). */
export interface SlotMiss {
  readonly slot: SlotFact;
  readonly measured: { readonly value: number; readonly unit: QaUnit };
  readonly params: Readonly<Record<string, string | number>>;
}

const pct = (share: number) => Math.round(share * 100);

/** A check over the slots it could hold: pass, or fail with a finding per miss and a fix for the first five. */
export function slotCheck(
  id: QaCheckId,
  instruction: string,
  held: number,
  misses: readonly SlotMiss[],
): QaCheckResult {
  if (held === 0) return skipped(id);
  const sorted = [...misses].sort((a, b) => a.slot.number - b.slot.number);
  const findings: QaFinding[] = sorted.map((miss) => ({
    ...(miss.slot.span ? { frames: { start: miss.slot.span.start, end: miss.slot.span.end } } : {}),
    target: { kind: 'clip', id: miss.slot.target },
    measured: miss.measured,
  }));
  const fixes: QaFix[] = sorted.map((miss) =>
    agentFix(`qa.fixes.${instruction}`, {
      slot: miss.slot.number,
      slotId: miss.slot.slotId,
      ...(miss.slot.clipId ? { clipId: miss.slot.clipId } : {}),
      ...miss.params,
    }),
  );
  return checkResult(
    id,
    // A video may differ from its reel on purpose: a miss warns (its fixes kept) and never blocks the person's
    // export; video.done holds the AI to it.
    sorted.length > 0 ? 'warn' : 'pass',
    {
      measured: { value: sorted.length, unit: 'count' },
      threshold: { max: 0, unit: 'count' },
      findings,
      fixes,
    },
    0,
  );
}

/** slotNeeds: every need the Analyst stated for a slot, shown by its footage. */
export function slotNeedsCheck(fact: SlotMatchFact): QaCheckResult {
  const held = fact.slots.filter((slot) => slot.needs.length > 0);
  const misses = held.flatMap((slot): SlotMiss[] => {
    const unmet = slot.needs.filter((need) => !need.met);
    if (unmet.length === 0) return [];
    const first = unmet[0]!;
    return [
      {
        slot,
        measured: { value: unmet.length, unit: 'count' },
        params: {
          need: first.text,
          unmet: unmet.length,
          needs: slot.needs.length,
          // Other shots of the draft or the cast's alternates that meet it: candidates to swap in.
          others: first.others,
          tools: slot.clipId
            ? 'timeline.findAlternates, timeline.swapClip, library.search, timeline.slipClip'
            : 'timeline.fillGap, library.search, timeline.swapClip',
        },
      },
    ];
  });
  return slotCheck('slotNeeds', 'matchSlotNeeds', held.length, misses);
}

/** slotFace: a face kept out where the reel hides it, and shown where the reel shows it. */
export function slotFaceCheck(fact: SlotMatchFact): QaCheckResult {
  const held = fact.slots.filter((slot) => slot.face.wanted !== null && slot.face.samples > 0);
  const misses = held.flatMap((slot): SlotMiss[] => {
    const share = slot.face.shown / slot.face.samples;
    const hidden = slot.face.wanted === 'hidden';
    const fails = hidden ? share > SLOT_MATCH.face.hiddenMax : share < SLOT_MATCH.face.shownMin;
    if (!fails) return [];
    return [
      {
        slot,
        measured: { value: pct(share), unit: 'percent' },
        params: {
          wanted: slot.face.wanted!,
          facePct: pct(share),
          tools: hidden
            ? 'timeline.slipClip, timeline.setReframe, timeline.swapClip, timeline.findAlternates'
            : 'timeline.slipClip, timeline.swapClip, timeline.findAlternates, timeline.setReframe',
        },
      },
    ];
  });
  return slotCheck('slotFace', 'matchSlotFace', held.length, misses);
}

const middle = (box: ShareBox) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });

/** slotFraming: the main person where the reel has them, about as big. */
export function slotFramingCheck(fact: SlotMatchFact): QaCheckResult {
  const limits = SLOT_MATCH.framing;
  const held = fact.slots.filter(
    (slot) => slot.framing.reel !== null && slot.framing.measured && slot.clipId,
  );
  const misses = held.flatMap((slot): SlotMiss[] => {
    const reel = slot.framing.reel!;
    const draft = slot.framing.draft;
    const tools = 'timeline.setReframe, timeline.setClipFit, timeline.slipClip, timeline.swapClip';
    const at = middle(reel);
    const reelParams = { reelX: pct(at.x), reelY: pct(at.y), reelSize: pct(reel.height) };
    if (!draft)
      return [
        { slot, measured: { value: 100, unit: 'percent' }, params: { ...reelParams, nobody: 1, tools } },
      ];
    const drawn = middle(draft);
    const across = drawn.x - at.x;
    const down = drawn.y - at.y;
    const size = draft.height / Math.max(1e-6, reel.height);
    const fails =
      Math.abs(across) > limits.across ||
      Math.abs(down) > limits.down ||
      size < limits.minSize ||
      size > limits.maxSize;
    if (!fails) return [];
    return [
      {
        slot,
        measured: { value: pct(Math.max(Math.abs(across), Math.abs(down))), unit: 'percent' },
        params: {
          ...reelParams,
          draftX: pct(drawn.x),
          draftY: pct(drawn.y),
          draftSize: pct(draft.height),
          tools,
        },
      },
    ];
  });
  return slotCheck('slotFraming', 'matchSlotFraming', held.length, misses);
}

/** slotMotion: the shot's camera move of the reel's kind (casting's families: a pan for a tilt passes). */
export function slotMotionCheck(fact: SlotMatchFact): QaCheckResult {
  const families = CASTING_CONFIG.motion.families;
  const held = fact.slots.filter((slot) => slot.motion.reel !== null && slot.motion.shot !== null);
  const misses = held.flatMap((slot): SlotMiss[] => {
    const { reel, shot } = slot.motion;
    if (reel === shot || families[reel!] === families[shot!]) return [];
    return [
      {
        slot,
        measured: { value: 1, unit: 'count' },
        params: {
          reel: reel!,
          shot: shot!,
          tools: 'timeline.findAlternates, timeline.swapClip, timeline.setReframe, timeline.setSpeed',
        },
      },
    ];
  });
  return slotCheck('slotMotion', 'matchSlotMotion', held.length, misses);
}

/** slotTiming: each slot about as long as the reel's (a dropped slot is 0 s long). */
export function slotTimingCheck(fact: SlotMatchFact): QaCheckResult {
  const { share, seconds } = SLOT_MATCH.timing;
  const ms = (value: number) => Math.round(value * 1000);
  const misses = fact.slots.flatMap((slot): SlotMiss[] => {
    const off = slot.draftSeconds - slot.reelSeconds;
    if (Math.abs(off) <= Math.max(share * slot.reelSeconds, seconds)) return [];
    return [
      {
        slot,
        measured: { value: Math.round(off * 1000) / 1000, unit: 'seconds' },
        params: {
          reelMs: ms(slot.reelSeconds),
          draftMs: ms(slot.draftSeconds),
          tools: slot.clipId
            ? 'timeline.trimClip, timeline.resyncBeats, timeline.setSpeed'
            : 'timeline.fillGap, timeline.insertClip',
        },
      },
    ];
  });
  return slotCheck('slotTiming', 'matchSlotTiming', fact.slots.length, misses);
}
