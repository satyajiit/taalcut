// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, type ChatEvent, type MessageId, type RunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { applyEvent, EMPTY_TRANSCRIPT, replay, type Transcript } from '../src/chat/transcript';

const runId = newId<'AgentRun'>();
const conversationId = newId<'Conversation'>();
const firstMessage = newId<'Message'>();
const finalMessage = newId<'Message'>();

const started: ChatEvent = { type: 'agent.runStarted', at: 0, payload: { runId, conversationId } };
const thought = (delta: string, at: number): ChatEvent => ({
  type: 'agent.reasoningDelta',
  at,
  payload: { runId, delta },
});
const words = (messageId: MessageId, delta: string, at: number, owner = runId): ChatEvent => ({
  type: 'agent.messageDelta',
  at,
  payload: { runId: owner, messageId, delta },
});
const messages = (state: Transcript) => state.items.filter((item) => item.kind === 'agent');
const reasoning = (state: Transcript) => state.items.find((item) => item.kind === 'reasoning');

function captures(): ChatEvent[] {
  return Array.from({ length: 9 }, (_, index): ChatEvent[] => {
    const toolRunId = newId<'ToolRun'>();
    const at = 100 + index * 200;
    return [
      {
        type: 'agent.toolStarted',
        at,
        payload: { runId, toolRunId, tool: 'media.captureFrame', sideEffect: 'read' },
      },
      {
        type: 'agent.toolFinished',
        at: at + 100,
        payload: { runId, toolRunId, tool: 'media.captureFrame', status: 'succeeded', durationMs: 100 },
      },
    ];
  }).flat();
}

describe('live transcript phases', () => {
  it('follows real words, repeated tools, resumed thinking and a final answer without stale streaming', () => {
    const events: ChatEvent[] = [
      started,
      thought('Compare the ', 10),
      thought('closing frames.', 20),
      words(firstMessage, 'I’ll compare ', 30),
      words(firstMessage, 'the closing shot.', 40),
      ...captures(),
      thought(' The reflection ', 2_000),
      thought('stays in the sky.', 2_100),
      words(finalMessage, 'The last shot ', 2_200),
      words(finalMessage, 'has a pink reflection.', 2_300),
      { type: 'agent.runFinished', at: 2_400, payload: { runId, status: 'succeeded' } },
    ];
    let live = EMPTY_TRANSCRIPT;
    for (const event of events) {
      live = applyEvent(live, event);
      if (event.at === 40) {
        expect(messages(live)).toMatchObject([{ text: 'I’ll compare the closing shot.', streaming: true }]);
        expect(reasoning(live)).toMatchObject({
          text: 'Compare the closing frames.',
          currentText: 'Compare the closing frames.',
          segments: ['Compare the closing frames.'],
          working: false,
          startedAt: 10,
          endedAt: 30,
        });
      }
      if (event.type === 'agent.toolStarted' || event.type === 'agent.toolFinished') {
        expect(messages(live)).toMatchObject([{ text: 'I’ll compare the closing shot.', streaming: false }]);
        expect(reasoning(live)?.working).toBe(false);
      }
      if (event.at === 2_100) {
        expect(reasoning(live)).toMatchObject({
          text: 'Compare the closing frames. The reflection stays in the sky.',
          currentText: ' The reflection stays in the sky.',
          segments: ['Compare the closing frames.', ' The reflection stays in the sky.'],
          working: true,
          startedAt: 2_000,
        });
        expect(reasoning(live)).not.toHaveProperty('endedAt');
      }
      if (event.at === 2_300) {
        expect(messages(live)).toMatchObject([
          { text: 'I’ll compare the closing shot.', streaming: false },
          { text: 'The last shot has a pink reflection.', streaming: true },
        ]);
        expect(reasoning(live)).toMatchObject({ working: false, startedAt: 2_000, endedAt: 2_200 });
      }
    }
    expect(messages(live).map((item) => item.streaming)).toEqual([false, false]);
    expect(live.activeRunId).toBeNull();
    expect(live.runs[runId]).toBe('succeeded');
    expect(replay(events)).toEqual(live);
  });

  it('retains exact raw deltas while recording display boundaries for each resumed segment', () => {
    const events = [
      started,
      thought('Check continuity.', 1),
      words(firstMessage, 'The samples are ready.', 2),
      thought('The closing ', 3),
      thought('shot needs cleanup.', 4),
    ];
    const state = replay(events);
    expect(reasoning(state)).toMatchObject({
      text: 'Check continuity.The closing shot needs cleanup.',
      currentText: 'The closing shot needs cleanup.',
      segments: ['Check continuity.', 'The closing shot needs cleanup.'],
    });
    expect(reasoning(state)?.segments?.join('\n\n')).toBe(
      'Check continuity.\n\nThe closing shot needs cleanup.',
    );
    const legacy: Transcript = {
      ...state,
      items: [
        {
          kind: 'reasoning',
          key: `reasoning:${runId}`,
          runId,
          text: 'Older thought.',
          working: false,
          startedAt: 1,
          endedAt: 2,
        },
      ],
    };
    expect(reasoning(applyEvent(legacy, thought('A new thought.', 5)))).toMatchObject({
      text: 'Older thought.A new thought.',
      currentText: 'A new thought.',
      segments: ['Older thought.', 'A new thought.'],
    });
    expect(events.reduce(applyEvent, EMPTY_TRANSCRIPT)).toEqual(state);
  });

  it('only marks the latest message in the same run as streaming, preserving another run’s text', () => {
    const otherRun: RunId = newId<'AgentRun'>();
    const otherMessage = newId<'Message'>();
    const state = replay([
      started,
      words(otherMessage, 'Another run.', 1, otherRun),
      words(firstMessage, 'Checking the shot.', 2),
      words(finalMessage, 'I found ', 3),
      words(finalMessage, 'the reflection.', 4),
    ]);
    expect(messages(state)).toMatchObject([
      { text: 'Another run.', streaming: true },
      { text: 'Checking the shot.', streaming: false },
      { text: 'I found the reflection.', streaming: true },
    ]);
    const thinking = applyEvent(state, thought('Check its timing.', 5));
    expect(messages(thinking).map((item) => item.streaming)).toEqual([true, false, false]);
  });

  it.each<ChatEvent>([
    {
      type: 'agent.plan',
      at: 20,
      payload: { runId, steps: [{ id: 'inspect', text: 'Inspect the shot', status: 'pending' }] },
    },
    {
      type: 'agent.card',
      at: 20,
      payload: {
        runId,
        card: {
          type: 'error',
          id: 'inspect-error',
          version: 1,
          error: { code: 'core.timeout', messageKey: 'errors.core.timeout', retryable: true },
        },
      },
    },
    {
      type: 'agent.approvalRequested',
      at: 20,
      payload: {
        runId,
        approvalId: 'approve-edit',
        tool: 'timeline.replace',
        sideEffect: 'write',
        reason: 'Replace the closing shot.',
      },
    },
  ])('settles the explanation when $type arrives', (event) => {
    const state = replay([started, words(firstMessage, 'I’ll inspect the shot.', 10), event]);
    expect(messages(state)).toMatchObject([{ text: 'I’ll inspect the shot.', streaming: false }]);
    expect(state.items.at(-1)?.kind).toBe('card');
  });

  it.each(['failed', 'cancelled'] as const)(
    'keeps partial words but clears active phases when %s',
    (status) => {
      const toolRunId = newId<'ToolRun'>();
      const state = replay([
        started,
        words(firstMessage, 'Checking the shot.', 1),
        {
          type: 'agent.toolStarted',
          at: 2,
          payload: { runId, toolRunId, tool: 'vision.describeFrame', sideEffect: 'read' },
        },
        thought('The image is ', 3),
        words(finalMessage, 'I could only inspect ', 4),
        { type: 'agent.runFinished', at: 5, payload: { runId, status } },
      ]);
      expect(messages(state)).toMatchObject([
        { text: 'Checking the shot.', streaming: false },
        { text: 'I could only inspect ', streaming: false },
      ]);
      expect(reasoning(state)).toMatchObject({ text: 'The image is ', working: false, endedAt: 4 });
      expect(state.items.find((item) => item.kind === 'card' && item.card.id === toolRunId)).toMatchObject({
        card: { status: 'cancelled' },
      });
      expect(state.runs[runId]).toBe(status);
      expect(state.activeRunId).toBeNull();
    },
  );
});
