// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X1: the chat-title call is a paid model call like any other. It is
 * checked against the conversation's project cap first, and its CloudCall row
 * carries the project and the run, so projectSpend counts it.
 */
import { newId, unwrap, type CloudCallRecord, type ProjectId } from '@taalcut/core';
import {
  createChatService,
  createConversationTitler,
  createMemoryConversationStore,
  createScriptedModelClient,
  provisionalTitle,
  type ChatEvent,
  type ConversationStore,
} from '@taalcut/agent';
import type { ModulePrice, PriceLookup } from '@taalcut/models';
import { describe, expect, it, vi } from 'vitest';
import { harness, plan, turns } from './support/harness';
import { fakeBudgetStore, usd } from './support/ports';

const MESSAGE = "Add my Desktop/Trip folder and tell me what's in the first video.";

const priced = (local: boolean): PriceLookup => ({
  price: (module) =>
    ({
      module,
      provider: local ? 'ollama' : 'openai',
      model: local ? 'gemma' : 'gpt-5.4-nano',
      local,
      usdPerMTok: local ? { input: 0, output: 0, cacheRead: 0 } : { input: 1, output: 4, cacheRead: 0.1 },
    }) satisfies ModulePrice,
  options: () => [],
});

/** The memory store, with the conversation on a project (the chat's first flow sets it in the app). */
function onProject(store: ConversationStore, projectId: ProjectId): ConversationStore {
  return {
    ...store,
    get: async (id) => {
      const got = await store.get(id);
      return got.ok
        ? { ...got, value: { ...got.value, conversation: { ...got.value.conversation, projectId } } }
        : got;
    },
  };
}

async function titled(options: { spentUsd: number; capUsd: number; local?: boolean }) {
  const projectId = newId<'Project'>();
  const h = harness({ script: turns(plan('Look'), { text: 'The first video shows a beach at dawn.' }) });
  const calls: CloudCallRecord[] = [];
  const models = createScriptedModelClient(() => ({ text: 'Beach video at dawn' }), {
    callLog: { record: (r) => calls.push(r) },
  });
  const budgets = fakeBudgetStore({
    [projectId]: { cap: usd(options.capUsd), spent: usd(options.spentUsd) },
  });
  const conversations = createMemoryConversationStore();
  const chat = createChatService({
    agent: h.agent,
    conversations: onProject(conversations, projectId),
    titles: createConversationTitler(models, { prices: priced(options.local ?? false), budgets }),
  });
  const conversationId = newId<'Conversation'>();
  const sent = unwrap(
    await chat.send({ conversationId, text: MESSAGE }, { signal: new AbortController().signal }),
  );
  for await (const _ of sent.events as AsyncIterable<ChatEvent>);
  const stored = async () => unwrap(await conversations.get(conversationId));
  return { projectId, models, calls, stored };
}

describe('the chat-title call and the project cap', () => {
  it('under the cap: the call carries the project and the run, so its spend counts', async () => {
    const t = await titled({ spentUsd: 0.5, capUsd: 5 });
    await vi.waitFor(async () => expect((await t.stored()).conversation.title).toBe('Beach video at dawn'));
    const runId = (await t.stored()).runs[0]!.runId;
    expect(t.models.requests[0]!.trace).toEqual({ projectId: t.projectId, runId });
    expect(t.calls).toMatchObject([{ module: 'agent', projectId: t.projectId, runId }]);
  });

  it('over the cap: no cloud call, and the chat keeps its provisional title', async () => {
    const t = await titled({ spentUsd: 5, capUsd: 5 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(t.models.requests).toEqual([]);
    expect(t.calls).toEqual([]);
    expect((await t.stored()).conversation.title).toBe(provisionalTitle(MESSAGE));
  });

  it('over the cap, a model on this Mac still names the chat (it costs nothing)', async () => {
    const t = await titled({ spentUsd: 5, capUsd: 5, local: true });
    await vi.waitFor(async () => expect((await t.stored()).conversation.title).toBe('Beach video at dawn'));
    expect(t.models.requests).toHaveLength(1);
  });
});
