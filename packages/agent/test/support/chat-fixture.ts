// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId } from '@taalcut/core';
import {
  createChatService,
  createMemoryConversationStore,
  type ModelScript,
  type ChatEvent,
  type ChatHistoryEvent,
} from '@taalcut/agent';
import { harness, call, plan, turns, type HarnessOptions } from './harness';

export function setup(options: Partial<HarnessOptions> & { script: ModelScript }) {
  const h = harness(options);
  const conversations = createMemoryConversationStore();
  const chat = createChatService({ agent: h.agent, conversations });
  return { ...h, conversations, chat, conversationId: newId<'Conversation'>() };
}

export async function collect(events: AsyncIterable<ChatEvent>, onEvent: (e: ChatEvent) => void = () => {}) {
  const seen: ChatEvent[] = [];
  for await (const event of events) {
    seen.push(event);
    onEvent(event);
  }
  return seen;
}

/** Assistant text by message, the way the transcript joins deltas. */
export function texts(events: readonly ChatHistoryEvent[]): string[] {
  const byId = new Map<string, string>();
  for (const e of events)
    if (e.type === 'agent.messageDelta')
      byId.set(e.payload.messageId, (byId.get(e.payload.messageId) ?? '') + e.payload.delta);
  return [...byId.values()];
}

export const countScript = turns(
  plan('Count the words'),
  { toolCalls: [call('clips_countWords', { text: 'a b c' })] },
  { text: 'It has 3 words.' },
);
