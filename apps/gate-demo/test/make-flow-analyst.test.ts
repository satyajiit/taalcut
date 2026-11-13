// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The stand-in follows resolveCuts' local descriptions, frame fallback and page boundaries. */
import { renderOutput } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import type { RequestView, ToolCall } from '../src/anthropic-view';
import { REFERENCE_SHOTS } from '../src/make-flow-fixtures';
import { makeFlowTurn } from '../src/make-flow-script';

const BREAKDOWN = '01JABCDEFGHJKMNPQRSTVWXYZ0';
const tools = ['findTools', 'templates_resolveCuts', 'templates_setIntents', 'vision_describeFrame'];
const description = (index: number) => REFERENCE_SHOTS[index]!.description;
const intent = (index: number) => {
  const { motion: _measured, ...value } = REFERENCE_SHOTS[index]!.intent;
  return value;
};
const block = (index: number, text: string) =>
  `<untrusted id="${index}" source="vision">\n${text}\n</untrusted>`;
const slot = (index: number, frame: string | null, looks?: string) => ({
  index,
  frame,
  context: { seconds: 1, onBeat: true, ...(looks ? { looks } : {}) },
});

const pageSchema = {
  type: 'object',
  properties: {
    slots: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          context: { type: 'object', properties: { looks: { type: 'string', untrusted: 'vision' } } },
        },
      },
    },
  },
};

function view(slots: unknown[], blocks?: string[], looks: ToolCall[] = []): RequestView {
  const page = { total: slots.length, written: 0, slots };
  return {
    ask: 'Make a video like this reel: /reference.mp4',
    skill: 'templates.analyst',
    input: { projectId: 'project', reference: { kind: 'file', path: '/reference.mp4' } },
    tools,
    calls: [
      { name: 'templates_breakdown', input: {}, result: JSON.stringify({ breakdownId: BREAKDOWN }) },
      {
        name: 'templates_resolveCuts',
        input: { breakdownId: BREAKDOWN },
        result: blocks ? [JSON.stringify(page), ...blocks].join('\n\n') : renderOutput(page, pageSchema),
      },
      ...looks,
    ],
  };
}

const seen = (path: string, shot: number): ToolCall => ({
  name: 'vision_describeFrame',
  input: { path, at: { value: 0, rate: 1 }, detail: 'low' },
  result: `${JSON.stringify({ description: '[untrusted:1]' })}\n\n${block(1, description(shot))}`,
});

describe('stand-in Analyst slot descriptions', () => {
  it('writes an entirely pre-described page without calling vision on null frames', () => {
    const at = view([slot(0, null, description(4)), slot(1, null, description(3))]);
    expect(at.calls[1]!.result).toContain('[untrusted:1]');
    expect(at.calls[1]!.result).toContain('<untrusted id="1" source="vision">');
    expect(makeFlowTurn(at).toolCall).toEqual({
      name: 'templates_setIntents',
      args: {
        breakdownId: BREAKDOWN,
        intents: [
          { slotIndex: 0, intent: intent(4) },
          { slotIndex: 1, intent: intent(3) },
        ],
      },
    });
    expect(makeFlowTurn({ ...at, tools: ['findTools'] }).toolCall).toEqual({
      name: 'findTools',
      args: { query: 'templates.setIntents' },
    });
    const legacy = {
      ...at,
      calls: at.calls.map((call) => ({
        ...call,
        result: call.result.replaceAll('[untrusted:', '[untrusted '),
      })),
    };
    expect(makeFlowTurn(legacy).toolCall).toEqual(makeFlowTurn(at).toolCall);
  });

  it('reads only real frames on mixed pages and keeps their descriptions attached to their own slots', () => {
    const slots = [slot(0, null, description(4)), slot(1, '/one.jpg'), slot(2, null), slot(3, '/three.jpg')];
    expect(makeFlowTurn(view(slots)).toolCall).toMatchObject({
      name: 'vision_describeFrame',
      args: { path: '/one.jpg' },
    });
    expect(makeFlowTurn(view(slots, [], [seen('/one.jpg', 2)])).toolCall).toMatchObject({
      name: 'vision_describeFrame',
      args: { path: '/three.jpg' },
    });
    const written = makeFlowTurn(view(slots, [], [seen('/three.jpg', 0), seen('/one.jpg', 2)]));
    expect(written.toolCall).toEqual({
      name: 'templates_setIntents',
      args: {
        breakdownId: BREAKDOWN,
        intents: [
          { slotIndex: 0, intent: intent(4) },
          { slotIndex: 1, intent: intent(2) },
          { slotIndex: 2, intent: intent(2) },
          { slotIndex: 3, intent: intent(0) },
        ],
      },
    });
  });

  it('still inspects every slot of a frame-only page before writing it', () => {
    const slots = [slot(0, '/zero.jpg'), slot(1, '/one.jpg')];
    expect(makeFlowTurn(view(slots)).toolCall?.args.path).toBe('/zero.jpg');
    expect(makeFlowTurn(view(slots, [], [seen('/zero.jpg', 3)])).toolCall?.args.path).toBe('/one.jpg');
    expect(
      makeFlowTurn(view(slots, [], [seen('/zero.jpg', 3), seen('/one.jpg', 4)])).toolCall?.args.intents,
    ).toEqual([
      { slotIndex: 0, intent: intent(3) },
      { slotIndex: 1, intent: intent(4) },
    ]);
  });

  it('uses fixture roles for context-only slots instead of inventing a path', () => {
    const at = view([slot(2, null), slot(3, ''), slot(4, '   ')]);
    expect(makeFlowTurn(at).toolCall).toEqual({
      name: 'templates_setIntents',
      args: {
        breakdownId: BREAKDOWN,
        intents: [2, 3, 4].map((index) => ({ slotIndex: index, intent: intent(index) })),
      },
    });
  });

  it('loads a missing frame tool and prefers existing looks if a frame also appears', () => {
    const slots = [slot(0, '/unused.jpg', description(3)), slot(1, '/one.jpg')];
    const at = view(slots);
    const look = makeFlowTurn(at);
    expect(look.toolCall).toEqual({
      name: 'vision_describeFrame',
      args: { path: '/one.jpg', at: { value: 0, rate: 1 }, detail: 'low' },
    });
    expect(makeFlowTurn({ ...at, tools: ['findTools'] }).toolCall).toEqual({
      name: 'findTools',
      args: { query: 'vision.describeFrame' },
    });
    expect(makeFlowTurn(view(slots, [], [seen('/one.jpg', 0)])).toolCall?.args.intents).toEqual([
      { slotIndex: 0, intent: intent(3) },
      { slotIndex: 1, intent: intent(0) },
    ]);
  });
});
