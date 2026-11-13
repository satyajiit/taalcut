// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the chat keeps: reasoning in history as it streamed live (cut at the
 * per-message limit), and assistant messages from runs resumed at start-up.
 */
import { newId, unwrap } from '@taalcut/core';
import {
  createChatService,
  createMemoryConversationStore,
  REASONING_LIMIT,
  type ChatEvent,
  type ChatHistoryEvent,
} from '@taalcut/agent';
import type { ModelClient } from '@taalcut/models';
import { describe, expect, it } from 'vitest';
import { call, harness, plan, turns } from './support/harness';

async function collect(events: AsyncIterable<ChatEvent>) {
  const seen: ChatEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

const reasoningOf = (events: readonly ChatHistoryEvent[]) =>
  events.flatMap((e) => (e.type === 'agent.reasoningDelta' ? [e.payload.delta] : []));

const LONG = 'why '.repeat(REASONING_LIMIT);
const thoughtful = turns(
  { ...plan('Count the words'), reasoning: 'The user wants a count.' },
  { toolCalls: [call('clips_countWords', { text: 'a b c' })], reasoning: LONG },
  { text: 'It has 3 words.', reasoning: 'Three words.' },
);

/** A model that never answers: the process "dies" while waiting on it. */
const hanging: ModelClient = {
  stream: () => ({
    [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
    result: () => new Promise(() => {}),
  }),
  complete: () => new Promise(() => {}),
};

describe('reasoning', () => {
  it('streams live and replays in history the same way, cut at the limit per message', async () => {
    const h = harness({ script: thoughtful });
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const conversationId = newId<'Conversation'>();
    const sent = unwrap(
      await chat.send({ conversationId, text: 'Count "a b c"' }, { signal: new AbortController().signal }),
    );
    const live = reasoningOf(await collect(sent.events));

    expect(live).toEqual([
      'The user wants a count.',
      `${LONG.slice(0, REASONING_LIMIT)} […]`,
      'Three words.',
    ]);
    const { history } = unwrap(await chat.getConversation(conversationId));
    expect(reasoningOf(history)).toEqual(live);
    // History puts each model call's reasoning before what it said.
    const kinds = history.map((e) => e.type);
    expect(kinds.lastIndexOf('agent.reasoningDelta')).toBeLessThan(kinds.lastIndexOf('agent.messageDelta'));
    // The log keeps all of it.
    const responded = (await h.events(sent.runId)).filter((e) => e.type === 'model.responded');
    expect(JSON.stringify(responded)).toContain(LONG);
    chat.close();
  });
});

describe('runs resumed at start-up', () => {
  it('store their assistant messages in the conversation that started them', async () => {
    const conversations = createMemoryConversationStore();
    const before = harness({ script: thoughtful, deps: { models: hanging } });
    const first = createChatService({ agent: before.agent, conversations });
    const conversationId = newId<'Conversation'>();
    const sent = unwrap(
      await first.send({ conversationId, text: 'Count "a b c"' }, { signal: new AbortController().signal }),
    );
    first.close();

    // A new process: same log and conversations, a model that answers.
    const after = harness({ script: thoughtful, store: before.store });
    const second = createChatService({ agent: after.agent, conversations });
    expect(unwrap(await after.agent.recoverInterrupted())).toEqual([sent.runId]);
    expect(unwrap(await after.agent.wait(sent.runId)).status).toBe('completed');
    // A run outside any conversation stores nothing.
    unwrap(await after.agent.run({ conversationId: newId<'Conversation'>(), message: 'Count "a b c"' }));

    expect(unwrap(await second.listConversations())).toMatchObject([{ id: conversationId }]);
    const stored = unwrap(await conversations.get(conversationId));
    expect(stored.messages.map((m) => [m.role, m.runId])).toEqual([
      ['user', null],
      ['assistant', sent.runId],
    ]);
    expect(stored.messages[1]?.parts).toEqual([{ type: 'text', text: 'It has 3 words.' }]);
    second.close();
  });
});
