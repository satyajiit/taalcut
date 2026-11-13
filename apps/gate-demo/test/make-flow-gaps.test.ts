// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The stand-in's `agent.gaps` step (make-flow-gaps.ts): each gap's given fix, one call at a time, then a handoff
 * the skill's check accepts (every gap with its offered fixes and the one applied, each timeline's revision).
 */
import { describe, expect, it } from 'vitest';
import type { RequestView, ToolCall } from '../src/anthropic-view';
import { makeFlowTurn } from '../src/make-flow-script';

const PROJECT = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const TIMELINE = '01JABCDEFGHJKMNPQRSTVWXYZ1';
const TOOLS = ['findTools', 'handOff', 'timeline_dropSlot', 'timeline_markForFilming', 'timeline_gaps'];

const gaps = [
  {
    timelineId: TIMELINE,
    gapId: 'gap-weak',
    slotId: 'slot-2',
    state: 'weak',
    fixes: ['film', 'drop'],
    fix: 'film',
  },
  {
    timelineId: TIMELINE,
    gapId: 'gap-empty',
    slotId: 'slot-4',
    state: 'empty',
    fixes: ['film', 'drop'],
    fix: 'drop',
  },
  {
    timelineId: TIMELINE,
    gapId: 'gap-hook',
    slotId: 'slot-1',
    state: 'empty',
    fixes: ['film', 'generate', 'drop'],
    fix: 'generate',
  },
];

const view = (calls: ToolCall[]): RequestView => ({
  ask: 'Make a 30 s vlog of my trip',
  skill: 'agent.gaps',
  input: { projectId: PROJECT, timelineIds: [TIMELINE], gaps },
  calls,
  tools: TOOLS,
});

const wrote = (name: string, input: Record<string, unknown>, revision: number): ToolCall => ({
  name,
  input,
  result: JSON.stringify({ timelineId: TIMELINE, revision }),
});

describe('stand-in agent.gaps step', () => {
  it('drops, then films the weak pick, then hands off at the last revision', () => {
    const first = makeFlowTurn(view([]));
    expect(first.toolCall).toEqual({
      name: 'timeline_dropSlot',
      args: { projectId: PROJECT, timelineId: TIMELINE, itemId: 'gap-empty', mode: 'ripple' },
    });

    const drop = wrote('timeline_dropSlot', first.toolCall?.args ?? {}, 7);
    const second = makeFlowTurn(view([drop]));
    expect(second.toolCall).toEqual({
      name: 'timeline_markForFilming',
      args: { projectId: PROJECT, timelineId: TIMELINE, slotIds: ['slot-2'], on: true },
    });

    const film = wrote('timeline_markForFilming', second.toolCall?.args ?? {}, 8);
    const done = makeFlowTurn(view([drop, film]));
    expect(done.toolCall?.name).toBe('handOff');
    expect(done.toolCall?.args).toEqual({
      gaps: [
        {
          timelineId: TIMELINE,
          gapId: 'gap-weak',
          slotId: 'slot-2',
          fixes: ['film', 'drop'],
          applied: 'film',
        },
        {
          timelineId: TIMELINE,
          gapId: 'gap-empty',
          slotId: 'slot-4',
          fixes: ['film', 'drop'],
          applied: 'drop',
        },
        // No image key in the journeys: generate can't run, so the gap waits for footage (the prompt's rule).
        {
          timelineId: TIMELINE,
          gapId: 'gap-hook',
          slotId: 'slot-1',
          fixes: ['film', 'generate', 'drop'],
          applied: 'film',
        },
      ],
      filming: 2,
      timelines: [{ timelineId: TIMELINE, revision: 8 }],
    });
  });

  it('a borrow gives the other shot its clip first, then takes it; a reuse fills with another part (FIX-ASK)', () => {
    const tools = [...TOOLS, 'timeline_swapClip', 'timeline_fillGap'];
    const neon = { assetId: 'asset-neon', shotId: 'shot-neon' };
    const phone = { assetId: 'asset-phone', shotId: 'shot-phone' };
    const walk = { assetId: 'asset-walk', shotId: 'shot-walk' };
    const start = { value: 300, rate: { num: 30, den: 1 } };
    const traded = [
      {
        timelineId: TIMELINE,
        gapId: 'gap-opening',
        slotId: 'slot-1',
        state: 'weak',
        fixes: ['keep', 'borrow', 'film', 'drop'],
        fix: 'borrow',
        swapTo: phone,
        borrow: { clipId: 'clip-3', number: 3, instead: neon },
      },
      {
        timelineId: TIMELINE,
        gapId: 'gap-nine',
        slotId: 'slot-9',
        state: 'empty',
        fixes: ['reuse', 'film', 'drop'],
        fix: 'reuse',
        swapTo: walk,
        sourceStart: start,
      },
    ];
    const at = (calls: ToolCall[]): RequestView => ({
      ...view(calls),
      input: { projectId: PROJECT, timelineIds: [TIMELINE], gaps: traded },
      tools,
    });
    const first = makeFlowTurn(at([]));
    expect(first.toolCall).toEqual({
      name: 'timeline_swapClip',
      args: { projectId: PROJECT, timelineId: TIMELINE, clipId: 'clip-3', media: neon, from: 'agent' },
    });
    const giveBack = wrote('timeline_swapClip', first.toolCall?.args ?? {}, 4);
    const second = makeFlowTurn(at([giveBack]));
    expect(second.toolCall).toEqual({
      name: 'timeline_swapClip',
      args: { projectId: PROJECT, timelineId: TIMELINE, clipId: 'gap-opening', media: phone, from: 'agent' },
    });
    const taken = wrote('timeline_swapClip', second.toolCall?.args ?? {}, 5);
    const third = makeFlowTurn(at([giveBack, taken]));
    expect(third.toolCall).toEqual({
      name: 'timeline_fillGap',
      args: {
        projectId: PROJECT,
        timelineId: TIMELINE,
        gapId: 'gap-nine',
        media: { kind: 'video', ...walk, sourceStart: start },
      },
    });
    const filled = wrote('timeline_fillGap', third.toolCall?.args ?? {}, 6);
    const done = makeFlowTurn(at([giveBack, taken, filled]));
    expect(done.toolCall?.name).toBe('handOff');
    expect((done.toolCall?.args.gaps as { applied: string }[]).map((g) => g.applied)).toEqual([
      'borrow',
      'reuse',
    ]);
    expect(done.toolCall?.args.timelines).toEqual([{ timelineId: TIMELINE, revision: 6 }]);
  });

  it('loads a tool the step has not loaded with findTools first', () => {
    const turn = makeFlowTurn({ ...view([]), tools: ['findTools', 'handOff'] });
    expect(turn.toolCall).toEqual({ name: 'findTools', args: { query: 'timeline.dropSlot' } });
  });
});
