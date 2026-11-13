// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2: the stand-in Maker's round in the make flow's journeys (make-flow-script.ts finishes like the Editor did). */
import { resultJson, type RequestView, type ToolCall } from './anthropic-view';
import { call, callsTo, need, use, withReads, type Json } from './make-flow-reads';
import type { DemoTurn } from './script';

/** What the stand-in says of a slot it can't bring closer to the reel: it has no other footage to try. */
export const STAND_IN_SLOT_REASON = 'The library has no clip closer to the reel for this slot.';

/** The slot numbers a video.done refusal names ("slot 3", "Slot 12"), once each, in order. */
export function refusedSlots(text: string): number[] {
  const slots = [...text.matchAll(/\bslot (\d{1,3})\b/gi)].map((match) => Number(match[1]));
  return [...new Set(slots)].filter((slot) => slot >= 1 && slot <= 200);
}

/** How many times the stand-in calls video.done before it hands off all the same (the Maker's check then says why). */
export const STAND_IN_DONE_CALLS = 6;

const slotsReasoned = (done: ToolCall): number[] =>
  Array.isArray(done.input.reasons)
    ? done.input.reasons.flatMap((reason: unknown) => {
        const slot = (reason as { slot?: unknown } | null)?.slot;
        return typeof slot === 'number' ? [slot] : [];
      })
    : [];

/**
 * The slots the next video.done gives the stand-in's reason, or null to hand off: every slot a refusal so far named
 * (a refusal names the first few and counts the rest, so a later one names more), once the last call left one out.
 */
export function nextDoneReasons(dones: readonly ToolCall[]): number[] | null {
  const last = dones.at(-1);
  if (!last || typeof resultJson(last.result)?.renderId === 'string' || dones.length >= STAND_IN_DONE_CALLS)
    return null;
  const slots = [...new Set(dones.flatMap((done) => refusedSlots(done.result)))];
  const given = new Set(slotsReasoned(last));
  return slots.some((slot) => !given.has(slot)) ? slots : null;
}

/**
 * AGT2: the Maker's round: a draft of the revision its edits reached, then video.done, then the handoff with that
 * draft. The slots refusals name are left with the stand-in's reason (it has nothing else to cast), until video.done
 * passes or names no slot it wasn't given; then it hands off, and the Maker's check says why if it still fails.
 */
export function draftThenHandOff(view: RequestView, input: Json, revision: unknown): DemoTurn {
  const draft = need(view, 'render_draft', { renderId: '/render/id' });
  if ('missing' in draft)
    return call(
      view,
      'render_draft',
      { projectId: input.projectId, timelineId: input.timelineId, revision },
      'Rendering a draft to compare with the reel.',
    );
  if (draft.turn) return draft.turn;
  const dones = callsTo(view, 'video_done');
  const ask = { projectId: input.projectId, timelineId: input.timelineId };
  if (dones.length === 0)
    return withReads(call(view, 'video_done', ask, 'Checking the draft against the reel.'), draft);
  const slots = nextDoneReasons(dones);
  if (!slots)
    return withReads(
      use('handOff', { timelineId: input.timelineId, revision, renderId: draft.json.renderId }),
      draft,
    );
  return withReads(
    use('video_done', {
      ...ask,
      reasons: slots.map((slot) => ({ slot, reason: STAND_IN_SLOT_REASON })),
    }),
    draft,
  );
}
