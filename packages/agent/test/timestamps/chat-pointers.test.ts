// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P3-V15 in the chat: the stored user message carries what its words pointed at, for the chips. */
import { newId, unwrap, type ChatEvent, type SelectionChip } from '@taalcut/core';
import { createChatService, createMemoryConversationStore, type ChatHistoryEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { harness } from '../support/harness';
import { actOnNote, resolverFor, templateReads } from './stand-ins';
import { videos, type Videos } from './videos';

async function drain(events: AsyncIterable<ChatEvent>) {
  for await (const _event of events) {
    // The run's events, until it finishes.
  }
}

/** The live agent.runStarted of one message sent through the chat. */
async function liveStart(v: Videos, text: string, selections: SelectionChip[]) {
  const h = harness({
    script: actOnNote(() => 'It opens on a wide street.'),
    modules: [templateReads()],
    deps: { phase3: { pointers: resolverFor(v) } },
  });
  const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
  const sent = unwrap(
    await chat.send(
      { conversationId: newId<'Conversation'>(), text, selections },
      { signal: new AbortController().signal },
    ),
  );
  const live: ChatEvent[] = [];
  for await (const event of sent.events) live.push(event);
  return live.find((event) => event.type === 'agent.runStarted');
}

describe('the chat history', () => {
  it("shows the message's pointers on the user's message", async () => {
    const v = videos();
    const h = harness({
      script: actOnNote(() => 'It opens on a wide street.'),
      modules: [templateReads()],
      deps: { phase3: { pointers: resolverFor(v) } },
    });
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const conversationId = newId<'Conversation'>();
    const chip = { kind: 'slot' as const, templateId: v.template.id, slotId: v.slotIds[0]! };
    const sent = unwrap(
      await chat.send(
        { conversationId, text: 'In the reference, what is in slot 2?', selections: [chip] },
        { signal: new AbortController().signal },
      ),
    );
    await drain(sent.events);
    const { history } = unwrap(await chat.getConversation(conversationId));
    const message = history.find(
      (e): e is Extract<ChatHistoryEvent, { type: 'user.message' }> => e.type === 'user.message',
    );
    expect(message?.payload.selections).toEqual([chip]);
    expect(message?.payload.pointers).toEqual([
      expect.objectContaining({ basis: 'template', kind: 'slot', slotNumber: 2, slotId: v.slotIds[1] }),
    ]);
  });

  it('shows them while the run is live: agent.runStarted carries them (round P3-3)', async () => {
    const v = videos();
    const chip = { kind: 'slot' as const, templateId: v.template.id, slotId: v.slotIds[0]! };
    const started = await liveStart(v, 'In the reference, what is in slot 2?', [chip]);
    expect(started?.payload).toMatchObject({
      pointers: [expect.objectContaining({ basis: 'template', kind: 'slot', slotNumber: 2 })],
    });
  });

  it('leaves them out of agent.runStarted when the message pointed at nothing', async () => {
    const started = await liveStart(videos(), 'Make it punchier.', []);
    expect(started?.payload).not.toHaveProperty('pointers');
  });
});
