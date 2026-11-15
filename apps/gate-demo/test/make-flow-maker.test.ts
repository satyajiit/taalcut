// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2: the stand-in Maker reads which slots a video.done refusal names, to leave them with its reason. TXT1: when
 * video.done holds the video for its text, it states the look and the place, drafts again and asks again.
 */
import { describe, expect, it } from 'vitest';
import type { RequestView, ToolCall } from '../src/anthropic-view';
import { editorTurn } from '../src/make-flow-editor';
import {
  nextDoneReasons,
  refusedSlots,
  STAND_IN_DONE_CALLS,
  STAND_IN_LOOK_NAME,
  STAND_IN_SLOT_REASON,
  STAND_IN_TEXT_LOOK,
  stateTheText,
  textHeld,
} from '../src/make-flow-maker';

const INPUT = { projectId: 'project', timelineId: 'timeline' };
const TOOLS = [
  'timeline_get',
  'timeline_textLook',
  'timeline_designText',
  'timeline_placeText',
  'render_draft',
  'video_done',
  'handOff',
];
const read: ToolCall = {
  name: 'timeline_get',
  input: { timelineId: 'timeline' },
  result: JSON.stringify({ timelineId: 'timeline', revision: 3, clips: [], texts: [] }),
};
const viewOf = (calls: ToolCall[], tools = TOOLS): RequestView => ({
  ask: 'Make a video like this reel: /reference.mp4',
  skill: 'timeline.maker',
  input: INPUT,
  calls,
  tools,
});
const drafted = (revision: number, id: string): ToolCall => ({
  name: 'render_draft',
  input: { ...INPUT, revision },
  result: JSON.stringify({ render: { id } }),
});
/** video.done's words while the text has neither a look nor a place (timeline's checkVideoDone). */
const held: ToolCall = {
  name: 'video_done',
  input: INPUT,
  result:
    "Error core.validation: The video's on-screen text has no designed look and would be drawn in the default " +
    'face: "label" (2 texts), "title" (1 text). Read timeline.textLook (the roles, the reference’s measured look, ' +
    'the faces), then give every role a look with timeline.designText, starting from the reference’s unless the ' +
    "person asked for another. Then render.draft again and call video.done. 3 of the video's on-screen texts " +
    'have no stated place or size yet: they sit where the reference had them. Read timeline.textLook (each ' +
    'group, what is under it here), look at the text in your draft frames, then state every group’s place and ' +
    'size with timeline.placeText (asReel: true keeps the reference’s). Then render.draft again and call ' +
    'video.done.',
};
const lookRead: ToolCall = {
  name: 'timeline_textLook',
  input: INPUT,
  result: JSON.stringify({
    timelineId: 'timeline',
    revision: 3,
    undesigned: ['label', 'title'],
    unplaced: ['text-1', 'text-3'],
  }),
};
const designed: ToolCall = {
  name: 'timeline_designText',
  input: INPUT,
  result: JSON.stringify({
    timelineId: 'timeline',
    revision: 4,
    styleId: 'style',
    roles: ['label', 'title'],
  }),
};
const placed: ToolCall = {
  name: 'timeline_placeText',
  input: INPUT,
  result: JSON.stringify({
    timelineId: 'timeline',
    revision: 5,
    affectedItemIds: ['text-1', 'text-2', 'text-3'],
    groups: [],
    unplaced: [],
    system:
      'label: 2 texts in 1 group, 1 size (55 px), 1 place; title: 1 text in 1 group, 1 size (80 px), 1 place',
    reading: 'Capitals under 36 px on this video are hard to read on a phone.',
  }),
};

describe('the stand-in Maker', () => {
  it('reads the slots a refusal names, once each, in order', () => {
    expect(refusedSlots('slot 2: slotFace … Slot 12: slotNeeds … slot 2: slotFraming')).toEqual([2, 12]);
    expect(refusedSlots('There is no draft of this timeline yet')).toEqual([]);
  });

  it('gives every slot the refusals so far named a reason, until video.done passes or names none it left out', () => {
    const done = (result: string, slots: number[] = []): ToolCall => ({
      name: 'video_done',
      input: { reasons: slots.map((slot) => ({ slot, reason: STAND_IN_SLOT_REASON })) },
      result,
    });
    const first = done('Error core.validation: slot 3: slotMotion … slot 5: slotMotion … and 1 more slots.');
    expect(nextDoneReasons([first])).toEqual([3, 5]);
    const second = done('Error core.validation: slot 9: slotMotion (1 count).', [3, 5]);
    expect(nextDoneReasons([first, second])).toEqual([3, 5, 9]);
    const passed = done(JSON.stringify({ renderId: '00000000000000000000000001' }), [3, 5, 9]);
    expect(nextDoneReasons([first, second, passed])).toBeNull();
    const qa = done('Error core.validation: the draft fails QA: loudness.', [3, 5, 9]);
    expect(nextDoneReasons([first, second, qa])).toBeNull();
    const many = Array.from({ length: STAND_IN_DONE_CALLS }, (_, n) => done(`slot ${n + 1}: slotFace`));
    expect(nextDoneReasons(many)).toBeNull();
  });
});

describe('the stand-in Maker states the text when video.done holds the video for it (TXT1)', () => {
  const first = drafted(3, 'draft-1');
  const turn = (...calls: ToolCall[]) => editorTurn(viewOf([read, first, ...calls]), true);

  it('knows a hold for the text by the tools the refusal names, and no other refusal', () => {
    expect(textHeld(held.result)).toBe(true);
    expect(textHeld('Error core.validation: slot 3: slotMotion (1 count).')).toBe(false);
    expect(textHeld(JSON.stringify({ renderId: 'draft-1' }))).toBe(false);
  });

  it('reads the text, gives every role without a look the stand-in look, places every group as the reference has it', () => {
    expect(turn().toolCall).toEqual({ name: 'video_done', args: INPUT });
    expect(turn(held).toolCall).toEqual({ name: 'timeline_textLook', args: INPUT });
    expect(turn(held, lookRead).toolCall).toEqual({
      name: 'timeline_designText',
      args: {
        ...INPUT,
        name: STAND_IN_LOOK_NAME,
        looks: ['label', 'title'].map((role) => ({ role, ...STAND_IN_TEXT_LOOK })),
      },
    });
    expect(turn(held, lookRead, designed).toolCall).toEqual({
      name: 'timeline_placeText',
      args: {
        ...INPUT,
        groups: [
          { itemId: 'text-1', asReel: true },
          { itemId: 'text-3', asReel: true },
        ],
      },
    });
  });

  it('then drafts the revision the placing reached, asks video.done again, and hands off that draft', () => {
    expect(turn(held, lookRead, designed, placed).toolCall).toEqual({
      name: 'render_draft',
      args: { ...INPUT, revision: 5 },
    });
    const second = drafted(5, 'draft-2');
    expect(turn(held, lookRead, designed, placed, second).toolCall).toEqual({
      name: 'video_done',
      args: INPUT,
    });
    const passed: ToolCall = { ...held, result: JSON.stringify({ renderId: 'draft-2' }) };
    expect(turn(held, lookRead, designed, placed, second, passed).toolCall).toEqual({
      name: 'handOff',
      args: { timelineId: 'timeline', revision: 5, renderId: 'draft-2' },
    });
  });

  it('only places when every role has a look already, and only designs when every group is placed', () => {
    const looked = (missing: Record<string, unknown>): ToolCall => ({
      ...lookRead,
      result: JSON.stringify({
        timelineId: 'timeline',
        revision: 3,
        undesigned: [],
        unplaced: [],
        ...missing,
      }),
    });
    expect(turn(held, looked({ unplaced: ['text-1'] })).toolCall?.name).toBe('timeline_placeText');
    const onlyDesign = looked({ undesigned: ['label'] });
    expect(turn(held, onlyDesign).toolCall?.name).toBe('timeline_designText');
    expect(turn(held, onlyDesign, designed).toolCall).toEqual({
      name: 'render_draft',
      args: { ...INPUT, revision: 4 },
    });
  });

  it('a slot refusal after the text is left with the stand-in’s reason, and a held call is not a slot round', () => {
    const second = drafted(5, 'draft-2');
    const slots: ToolCall = { ...held, result: 'Error core.validation: slot 3: slotMotion (1 count).' };
    expect(turn(held, lookRead, designed, placed, second, slots).toolCall).toEqual({
      name: 'video_done',
      args: { ...INPUT, reasons: [{ slot: 3, reason: STAND_IN_SLOT_REASON }] },
    });
  });

  it('states the text once: held again, it hands off and the Maker’s check says why', () => {
    const second = drafted(5, 'draft-2');
    expect(turn(held, lookRead, designed, placed, second, held).toolCall?.name).toBe('handOff');
  });

  it('ends the step with what a refused call said, and loads a tool its step was not offered', () => {
    const refused = {
      ...designed,
      result: 'Error core.validation: Anton (anton) has only weight 400, not 800.',
    };
    expect(turn(held, lookRead, refused)).toEqual({
      text: 'I could not design the text: Error core.validation: Anton (anton) has only weight 400, not 800.',
    });
    const unknown = {
      ...placed,
      result: 'Error timeline.invalid_move: No text of this video has the id text-1.',
    };
    expect(turn(held, lookRead, designed, unknown)).toEqual({
      text: 'I could not place the text: Error timeline.invalid_move: No text of this video has the id text-1.',
    });
    const few = viewOf([read, first, held], ['timeline_get', 'render_draft', 'video_done', 'findTools']);
    expect(stateTheText(few, INPUT, held)?.toolCall).toEqual({
      name: 'findTools',
      args: { query: 'timeline.textLook' },
    });
  });

  it('a draft that is not held goes on as before, and the docked Editor never drafts', () => {
    const passed: ToolCall = { ...held, result: JSON.stringify({ renderId: 'draft-1' }) };
    expect(turn(passed).toolCall?.name).toBe('handOff');
    expect(editorTurn(viewOf([read]), true).toolCall?.name).toBe('render_draft');
    expect(editorTurn(viewOf([read]), false).toolCall?.name).toBe('handOff');
  });
});
