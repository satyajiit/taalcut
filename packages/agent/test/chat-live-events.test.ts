// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { defineTool, defineToolModule, newId, NO_TOOL_RETRY, ok, unwrap, type EventOf } from '@taalcut/core';
import { createChatService, createMemoryConversationStore, type ChatEvent } from '@taalcut/agent';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { collect } from './support/chat-fixture';
import { call, harness, plan, turns } from './support/harness';

function setup() {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const assemble = defineTool({
    name: 'timeline.assemble',
    version: '1.0.0',
    description: 'Assemble a fixture draft.',
    input: z.object({}),
    output: z.object({ assembled: z.boolean() }),
    costClass: 'local',
    sideEffect: 'read',
    timeoutMs: 1000,
    retry: NO_TOOL_RETRY,
    run: async () => {
      started.resolve();
      await release.promise;
      return ok({ assembled: true });
    },
  });
  const h = harness({
    modules: [defineToolModule({ id: 'timeline', tools: [assemble] })],
    script: turns(plan('Assemble a draft'), { toolCalls: [call('timeline_assemble')] }, { text: 'Ready.' }),
  });
  const onToolFinished = vi.fn<(event: EventOf<'agent.toolFinished'>) => void>();
  const chat = createChatService({
    agent: h.agent,
    conversations: createMemoryConversationStore(),
    onToolFinished,
  });
  return { chat, started, release, onToolFinished, conversationId: newId<'Conversation'>() };
}

describe('live chat completion publication', () => {
  it('publishes after the renderer detaches without requiring a chat follower', async () => {
    const s = setup();
    const controller = new AbortController();
    const sent = unwrap(
      await s.chat.send({ conversationId: s.conversationId, text: 'Build a draft' }, controller),
    );
    await s.started.promise;
    controller.abort();
    await collect(sent.events);
    s.release.resolve();
    await vi.waitFor(() => expect(s.onToolFinished).toHaveBeenCalledTimes(1));
    expect(s.onToolFinished.mock.calls[0]?.[0]).toMatchObject({
      type: 'agent.toolFinished',
      payload: { runId: sent.runId, tool: 'timeline.assemble', status: 'succeeded' },
    });
    s.chat.close();
  });

  it('publishes once for multiple followers and never republishes history or follow priming', async () => {
    const s = setup();
    const signal = new AbortController().signal;
    const sent = unwrap(
      await s.chat.send({ conversationId: s.conversationId, text: 'Build a draft' }, { signal }),
    );
    await s.started.promise;
    const original = collect(sent.events);
    const followed = collect(s.chat.follow(sent.runId, { signal }));
    // A real history read primes a separate translator while the tool is still running.
    await s.chat.getConversation(s.conversationId);
    s.release.resolve();
    const [first, second] = await Promise.all([original, followed]);
    const finished = (events: ChatEvent[]) => events.filter((event) => event.type === 'agent.toolFinished');
    expect(finished(first)).toHaveLength(1);
    expect(finished(second)).toEqual(finished(first));
    expect(s.onToolFinished).toHaveBeenCalledExactlyOnceWith(finished(first)[0]);
    const history = unwrap(await s.chat.getConversation(s.conversationId)).history;
    expect(history.some((event) => event.type === 'agent.toolFinished')).toBe(true);
    expect(await collect(s.chat.follow(sent.runId, { signal }))).toEqual([]);
    expect(s.onToolFinished).toHaveBeenCalledTimes(1);
    s.chat.close();
  });
});
