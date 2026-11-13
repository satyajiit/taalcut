// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { err, newId, NotFoundError, unwrap } from '@taalcut/core';
import { createMemoryConversationStore } from '@taalcut/agent';
import { afterEach, expect, it, vi } from 'vitest';
import { createChatTitling } from '../src/chat-titles';

afterEach(() => vi.restoreAllMocks());

async function conversation() {
  const conversations = createMemoryConversationStore();
  const id = newId<'Conversation'>();
  const runId = newId<'AgentRun'>();
  unwrap(await conversations.create({ id, title: 'Airport reel' }));
  unwrap(
    await conversations.appendMessage({
      conversationId: id,
      role: 'user',
      parts: [{ type: 'text', text: 'Airport reel' }],
    }),
  );
  unwrap(
    await conversations.appendMessage({
      conversationId: id,
      role: 'assistant',
      runId,
      parts: [{ type: 'text', text: 'The airport reel uses city lights and planes.' }],
    }),
  );
  unwrap(await conversations.linkRun(id, runId));
  const title = async () => unwrap(await conversations.get(id)).conversation.title;
  return { conversations, id, title };
}

it('awaits the naming callback after the generated title is stored', async () => {
  const w = await conversation();
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const changed = vi.fn();
  const named = vi.fn(async (value) => {
    expect(value).toEqual({ id: w.id, title: 'Airport City Lights' });
    expect(await w.title()).toBe(value.title);
    entered.resolve();
    await release.promise;
  });
  const titling = createChatTitling({
    conversations: w.conversations,
    titles: async () => 'Airport City Lights',
    onChanged: changed,
    onNamed: named,
  });
  let settled = false;
  const done = titling(w.id).then(() => {
    settled = true;
  });
  await entered.promise;
  expect(settled).toBe(false);
  expect(changed).toHaveBeenCalledWith({ id: w.id, title: 'Airport City Lights' });
  release.resolve();
  await done;
  expect(named).toHaveBeenCalledTimes(1);
});

it('announces a successful generated title even when it already matches', async () => {
  const w = await conversation();
  const rename = vi.spyOn(w.conversations, 'rename');
  const changed = vi.fn();
  const named = vi.fn();
  const titling = createChatTitling({
    conversations: w.conversations,
    titles: async () => 'Airport reel',
    onChanged: changed,
    onNamed: named,
  });
  await titling(w.id);
  expect(rename).not.toHaveBeenCalled();
  expect(changed).not.toHaveBeenCalled();
  expect(named).toHaveBeenCalledExactlyOnceWith({ id: w.id, title: 'Airport reel' });
});

it('does not announce a title whose storage failed', async () => {
  const w = await conversation();
  vi.spyOn(w.conversations, 'rename').mockResolvedValue(
    err(NotFoundError({ entity: 'conversation', id: w.id })),
  );
  const named = vi.fn();
  const titling = createChatTitling({
    conversations: w.conversations,
    titles: async () => 'Airport City Lights',
    onNamed: named,
  });
  await titling(w.id);
  expect(named).not.toHaveBeenCalled();
  expect(await w.title()).toBe('Airport reel');
});

it('keeps a saved title and completed naming stage when its follow-up callback fails', async () => {
  const w = await conversation();
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  const titles = vi.fn(async () => 'Airport City Lights');
  const named = vi.fn(async () => {
    throw new Error('Project unavailable');
  });
  const titling = createChatTitling({ conversations: w.conversations, titles, onNamed: named });
  await expect(titling(w.id)).resolves.toBeUndefined();
  expect(await w.title()).toBe('Airport City Lights');
  await titling(w.id);
  expect(titles).toHaveBeenCalledTimes(1);
  expect(named).toHaveBeenCalledTimes(1);
  expect(warning).toHaveBeenCalledExactlyOnceWith('[chat-titles] Could not update the conversation title.');
});
