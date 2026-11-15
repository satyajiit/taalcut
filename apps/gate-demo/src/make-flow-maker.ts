// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** AGT2: the stand-in Maker's round in the make flow's journeys (make-flow-script.ts finishes like the Editor did). */
import { resultJson, type RequestView, type ToolCall } from './anthropic-view';
import { call, callsTo, list, need, readCall, use, withReads, type Json } from './make-flow-reads';
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
 * TXT1: the look the stand-in gives every text role that has none, each part stated as timeline.designText asks.
 * It designs nothing of its own: one look, the same for every role and every journey.
 */
export const STAND_IN_TEXT_LOOK = {
  font: { family: 'montserrat', weight: 800 },
  colour: '#ffffff',
  outline: { colour: '#000000', widthPx: 4 },
  shadow: null,
  box: null,
} as const;
export const STAND_IN_LOOK_NAME = 'Stand-in look';

/** A video.done refusal that holds the video for its text: it names the tools that state the look or the place. */
export const textHeld = (result: string): boolean => /timeline\.(designText|placeText)/.test(result);

/** What became of the one call to `tool` among `calls`: not made yet, answered with `key`, or refused (its words). */
function stated(
  calls: readonly ToolCall[],
  tool: string,
  key: string,
): 'todo' | 'done' | { refusal: string } {
  const made = calls.filter((entry) => entry.name === tool && entry.result !== '');
  // Answered: its JSON has the key, or the answer was large enough to be stored (a refusal never is).
  if (made.some((entry) => resultJson(entry.result)?.[key] !== undefined || /^Stored as /.test(entry.result)))
    return 'done';
  const refused = made.at(-1);
  return refused ? { refusal: refused.result.slice(0, 300) } : 'todo';
}

const strings = (value: unknown): string[] =>
  list(value).filter((entry): entry is string => typeof entry === 'string');

/**
 * TXT1: what the Maker does when video.done holds the video for its text (`held`, the refused call): it reads
 * timeline.textLook for the roles without a look and the groups nobody placed, gives each role the stand-in look
 * with timeline.designText, and places each group "as the reference has it" with timeline.placeText. The stand-in
 * judges nothing: one look for every role, the reference's place for every group. Undefined once both calls
 * answered (the round then drafts again). A refused call ends the step with what the tool said, as `need` does.
 */
export function stateTheText(view: RequestView, input: Json, held: ToolCall): DemoTurn | undefined {
  const since = view.calls.slice(view.calls.indexOf(held) + 1);
  const ask = { projectId: input.projectId, timelineId: input.timelineId };
  const look = since.findLast((entry) => entry.name === 'timeline_textLook');
  if (!look) return call(view, 'timeline_textLook', ask, 'Reading the text the draft was held for.');
  const missing = readCall(view, look, { undesigned: '/undesigned', unplaced: '/unplaced' });
  if (missing.turn) return missing.turn;
  const undesigned = strings(missing.json.undesigned);
  if (undesigned.length > 0) {
    const design = stated(since, 'timeline_designText', 'styleId');
    if (typeof design === 'object') return { text: `I could not design the text: ${design.refusal}` };
    if (design === 'todo')
      return withReads(
        call(
          view,
          'timeline_designText',
          {
            ...ask,
            name: STAND_IN_LOOK_NAME,
            looks: undesigned.map((role) => ({ role, ...STAND_IN_TEXT_LOOK })),
          },
          'Designing the look of the text.',
        ),
        missing,
      );
  }
  const unplaced = strings(missing.json.unplaced);
  if (unplaced.length > 0) {
    const place = stated(since, 'timeline_placeText', 'system');
    if (typeof place === 'object') return { text: `I could not place the text: ${place.refusal}` };
    if (place === 'todo')
      return withReads(
        call(
          view,
          'timeline_placeText',
          { ...ask, groups: unplaced.map((itemId) => ({ itemId, asReel: true })) },
          'Placing the text as the reference has it.',
        ),
        missing,
      );
  }
  return undefined;
}

/**
 * TXT1: the Maker's turn while video.done holds the video for its text, or undefined when it does not (or did
 * once already: the stand-in states the text once, and the Maker's check says why if that was not enough). It
 * states the text, drafts the revision that reached, and calls video.done again.
 */
function textRound(view: RequestView, input: Json, dones: readonly ToolCall[]): DemoTurn | undefined {
  const held = dones.at(-1);
  if (!held || !textHeld(held.result) || dones.filter((done) => textHeld(done.result)).length > 1)
    return undefined;
  const text = stateTheText(view, input, held);
  if (text) return text;
  const since = view.calls.slice(view.calls.indexOf(held) + 1);
  const ask = { projectId: input.projectId, timelineId: input.timelineId };
  const drafted = since.findLast((entry) => entry.name === 'render_draft');
  if (drafted) return call(view, 'video_done', ask, 'Checking the new draft against the reel.');
  const written = since.findLast(
    (entry) => entry.name === 'timeline_placeText' || entry.name === 'timeline_designText',
  );
  const reached = readCall(view, written, { revision: '/revision' });
  if (reached.turn) return reached.turn;
  if (typeof reached.json.revision !== 'number') return undefined;
  return withReads(
    call(
      view,
      'render_draft',
      { ...ask, revision: reached.json.revision },
      'Rendering a draft with the text.',
    ),
    reached,
  );
}

/**
 * AGT2: the Maker's round: a draft of the revision its edits reached, then video.done, then the handoff with that
 * draft. The slots refusals name are left with the stand-in's reason (it has nothing else to cast), until video.done
 * passes or names no slot it wasn't given; then it hands off, and the Maker's check says why if it still fails.
 * TXT1: a video.done that holds the video for its text sends it to state the text and draft again (`textRound`).
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
  const text = textRound(view, input, dones);
  if (text) return text;
  const ask = { projectId: input.projectId, timelineId: input.timelineId };
  if (dones.length === 0)
    return withReads(call(view, 'video_done', ask, 'Checking the draft against the reel.'), draft);
  // A call the text was held on is not one of the slots' rounds.
  const slots = nextDoneReasons(dones.filter((done) => !textHeld(done.result)));
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
