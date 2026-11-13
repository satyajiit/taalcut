// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { chatHistoryEventSchema, newId, unwrap, type ChatEvent } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeChatClient } from '../src/chat/fake-client';
import {
  FRAME_INSPECTION_ANSWER,
  FRAME_INSPECTION_INTRO,
  FRAME_INSPECTION_PROMPT,
  FRAME_INSPECTION_UPDATE,
} from '../src/chat/fake-frame-inspection-script';
import { replay } from '../src/chat/transcript';

describe('the airport frame inspection fixture', () => {
  it('streams real fixture prose around nine captures and three simultaneous inspections, then replays it', async () => {
    const client = createFakeChatClient({ speed: 0, latencyMs: 0 });
    const conversationId = newId<'Conversation'>();
    const sent = unwrap(
      await client.send(
        { conversationId, text: FRAME_INSPECTION_PROMPT },
        { signal: new AbortController().signal },
      ),
    );
    const events: ChatEvent[] = [];
    for await (const event of sent.events) {
      expect(chatHistoryEventSchema.safeParse(event).success).toBe(true);
      events.push(event);
    }
    const starts = events.filter((event) => event.type === 'agent.toolStarted');
    expect(starts.map((event) => event.payload.tool)).toEqual([
      ...Array<string>(9).fill('timeline.captureFrame'),
      ...Array<string>(3).fill('vision.describeFrame'),
    ]);
    const inspecting = replay(events.slice(0, events.indexOf(starts[11]!) + 1));
    const calls = inspecting.items.flatMap((item) =>
      item.kind === 'card' && item.card.type === 'toolRun' ? [item.card] : [],
    );
    expect(calls.filter((card) => card.status === 'succeeded')).toHaveLength(9);
    expect(calls.filter((card) => card.status === 'running')).toHaveLength(3);
    expect(inspecting.items.filter((item) => item.kind === 'agent')).toMatchObject([
      { text: FRAME_INSPECTION_INTRO, streaming: false },
      { text: FRAME_INSPECTION_UPDATE, streaming: false },
    ]);

    const completed = replay(events);
    expect(completed.items.filter((item) => item.kind === 'agent')).toMatchObject([
      { text: FRAME_INSPECTION_INTRO, streaming: false },
      { text: FRAME_INSPECTION_UPDATE, streaming: false },
      { text: FRAME_INSPECTION_ANSWER, streaming: false },
    ]);
    expect(completed.runs[sent.runId]).toBe('succeeded');
    const history = unwrap(await client.getConversation(conversationId)).history;
    expect(history).toEqual([sent.userMessage, ...events]);
    expect(replay(history).items.slice(1)).toEqual(completed.items);
  });

  it.each([
    ['agent.messageDelta', 'agent.messageDelta', 1],
    ['agent.messageDelta:2', 'agent.messageDelta', 2],
    ['agent.reasoningDelta:2', 'agent.reasoningDelta', 2],
    ['agent.toolStarted:12', 'agent.toolStarted', 12],
  ] as const)(
    'holds %s until stopped without emitting the next scripted event',
    async (holdAfter, type, count) => {
      const client = createFakeChatClient({ speed: 0, latencyMs: 0, holdAfter });
      const abort = new AbortController();
      const sent = unwrap(
        await client.send(
          { conversationId: newId<'Conversation'>(), text: FRAME_INSPECTION_PROMPT },
          { signal: abort.signal },
        ),
      );
      const iterator = sent.events[Symbol.asyncIterator]();
      const seen: ChatEvent[] = [];
      try {
        while (seen.filter((event) => event.type === type).length < count) {
          const event = await iterator.next();
          expect(event.done).toBe(false);
          if (event.done) break;
          seen.push(event.value);
        }
        const next = iterator.next();
        expect(
          await Promise.race([
            next.then(() => 'advanced'),
            new Promise((resolve) => setTimeout(() => resolve('held'), 0)),
          ]),
        ).toBe('held');
        expect(seen.filter((event) => event.type === type)).toHaveLength(count);
        abort.abort();
        expect(await next).toMatchObject({
          value: { type: 'agent.runFinished', payload: { status: 'cancelled' } },
        });
        expect(await iterator.next()).toMatchObject({ done: true });
      } finally {
        abort.abort();
      }
    },
  );
});
