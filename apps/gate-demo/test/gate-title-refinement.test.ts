// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The desktop keeps one title service alive through its first follow-up, then restarts before later asks. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newId, ok, unwrap, type CloudCallRecord } from '@taalcut/core';
import {
  createAgent,
  createChatService,
  createConversationTitler,
  createMemoryConversationStore,
  createMemoryEventLogStore,
  createScriptedModelClient,
  parseSoul,
  runMessage,
  runMessageIndex,
} from '@taalcut/agent';
import { createToolRegistry } from '@taalcut/tools';
import { expect, it, vi } from 'vitest';
import {
  createRecordedGateModels,
  GATE_DEMO_ANSWER,
  GATE_DEMO_ASK,
  GATE_DEMO_FIXTURES,
  GATE_DEMO_FOLLOW_UPS,
  GATE_DEMO_TITLE,
} from '../src';

it('replays initial and refined titles in one service, then keeps the title after restart', async () => {
  const calls: CloudCallRecord[] = [];
  const recorded = createRecordedGateModels(GATE_DEMO_FIXTURES, { home: '/Users/demo' });
  const models = recorded({
    record: async (row) => {
      calls.push(row);
      return ok(undefined);
    },
  });
  const conversations = createMemoryConversationStore();
  const log = createMemoryEventLogStore();
  const conversationId = newId<'Conversation'>();
  const named: string[] = [];
  const agent = createAgent({
    models: createScriptedModelClient((request) => {
      const current = request.messages.slice(runMessageIndex(request.messages));
      if (!current.some((message) => message.role === 'assistant'))
        return { toolCalls: [{ name: 'updatePlan', arguments: { steps: [{ text: 'Answer' }] } }] };
      const ask = runMessage(request);
      return {
        text:
          ask === GATE_DEMO_ASK ? GATE_DEMO_ANSWER : GATE_DEMO_FOLLOW_UPS.find((q) => q.ask === ask)!.answer,
      };
    }),
    tools: unwrap(createToolRegistry([])),
    log,
    soul: parseSoul(readFileSync(join(import.meta.dirname, '../../../SOUL.md'), 'utf8')),
    settings: { budget: {} },
  });
  const open = () =>
    createChatService({
      agent,
      conversations,
      titles: createConversationTitler(models.agent),
      onConversationNamed: ({ title }) => {
        named.push(title);
      },
    });
  let chat = open();
  const send = async (text: string) => {
    const sent = unwrap(await chat.send({ conversationId, text }, { signal: new AbortController().signal }));
    for await (const _ of sent.events);
    expect(unwrap(await agent.wait(sent.runId)).status).toBe('completed');
    return sent.runId;
  };
  try {
    const initial = await send(GATE_DEMO_ASK);
    await vi.waitFor(() => expect(named).toEqual([GATE_DEMO_TITLE]));
    const refinement = await send(GATE_DEMO_FOLLOW_UPS[0].ask);
    await vi.waitFor(() => expect(named).toEqual([GATE_DEMO_TITLE, GATE_DEMO_TITLE]));
    expect(calls.map(({ module, outcome, runId }) => ({ module, outcome, runId }))).toEqual([
      { module: 'agent', outcome: 'ok', runId: initial },
      { module: 'agent', outcome: 'ok', runId: refinement },
    ]);
    chat.close();
    chat = open();
    for (const ask of GATE_DEMO_FOLLOW_UPS.slice(1)) await send(ask.ask);
    expect(unwrap(await chat.getConversation(conversationId)).conversation.title).toBe(GATE_DEMO_TITLE);
    // Let the in-memory completion observers settle before checking that restart did not request another title.
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(calls).toHaveLength(2);
    expect(named).toHaveLength(2);
    expect(recorded.cassette.misses()).toEqual([]);
  } finally {
    chat.close();
    await recorded.cassette.save();
  }
});
