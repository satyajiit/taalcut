// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LRN1-MEM: memory.remember asks with its own card, "Remember this?" with the words and where they would apply, in
 * place of the generic approval card. The chat shows it pending, then approved and remembered with the stored
 * item's id, or declined with nothing stored; every event is one core's catalogue has.
 */
import { newId, ok, taalcutEventSchema, unwrap, type Card, type CardOf } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createChatService,
  createMemoryConversationStore,
  createMemoryEventLogStore,
  memoryRunFacts,
  memoryToolModule,
  type ChatEvent,
} from '../../src';
import { call, harness, ofType, plan, turns } from '../support/harness';
import { fakeRanker } from './memory-support';

const projectId = newId<'Project'>();
const templateId = newId<'Template'>();
const NAMES: Readonly<Record<string, string>> = { [projectId]: 'Goa trip', [templateId]: 'Sunset montage' };

function setup(args: Record<string, unknown>) {
  const store = createMemoryEventLogStore();
  const h = harness({
    script: turns(plan('Remember it'), { toolCalls: [call('memory_remember', args)] }, { text: 'Noted.' }),
    store,
    modules: [
      memoryToolModule({
        ranker: fakeRanker([]),
        run: memoryRunFacts(store),
        scopeName: async (scope) =>
          ok(
            scope.kind === 'user'
              ? null
              : (NAMES[scope.kind === 'project' ? scope.projectId : scope.templateId] ?? null),
          ),
      }),
    ],
  });
  return h;
}

async function collect(events: AsyncIterable<ChatEvent>) {
  const seen: ChatEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}
const proposals = (events: readonly ChatEvent[]): CardOf<'memoryProposal'>[] =>
  events.flatMap((e) =>
    e.type === 'agent.card' && e.payload.card.type === 'memoryProposal' ? [e.payload.card] : [],
  );

async function chatUntilAsked(args: Record<string, unknown>) {
  const h = setup(args);
  const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
  const signal = new AbortController().signal;
  const sent = unwrap(
    await chat.send({ conversationId: newId<'Conversation'>(), text: 'Never use whip pans.' }, { signal }),
  );
  const asked = await collect(sent.events);
  const answer = async (decision: 'approve' | 'deny') => {
    const following = collect(chat.follow(sent.runId, { signal }));
    const card = proposals(asked).at(-1)!;
    unwrap(await chat.decideApproval({ runId: sent.runId, approvalId: card.approvalId, decision }));
    return following;
  };
  return { h, chat, asked, answer };
}

describe('the "Remember this?" card (LRN1-MEM)', () => {
  it('asks with the words and where they apply, then shows them remembered with the item', async () => {
    const { h, chat, asked, answer } = await chatUntilAsked({
      text: 'Never use whip transitions.',
      scope: 'user',
    });
    expect(proposals(asked)).toEqual([
      expect.objectContaining({
        text: 'Never use whip transitions.',
        scope: { kind: 'user' },
        scopeName: null,
        status: 'pending',
      }),
    ]);
    // Its own card, not the generic "Can Taalcut go ahead?".
    expect(asked.some((e) => e.type === 'agent.card' && e.payload.card.type === 'approval')).toBe(false);

    const done = await answer('approve');
    const stored = h.applied[0]!.payload as { memoryId: string };
    expect(proposals(done).map((card) => [card.status, card.memoryId])).toEqual([
      ['approved', undefined],
      ['remembered', stored.memoryId],
    ]);
    expect(new Set([...proposals(asked), ...proposals(done)].map((card) => card.id)).size).toBe(1);
    for (const event of [...asked, ...done])
      expect(taalcutEventSchema.safeParse(event).success, event.type).toBe(true);
    chat.close();
  });

  it('shows it declined and stores nothing when the creator says Not now', async () => {
    const { h, chat, answer } = await chatUntilAsked({ text: 'Bold captions.', scope: 'user' });
    const done = await answer('deny');
    expect(proposals(done).map((card) => card.status)).toEqual(['declined']);
    expect(h.applied).toEqual([]);
    chat.close();
  });

  it("names the project or template it would apply to, by the library's name", async () => {
    const forProject = setup({ text: 'Open on the drone shot.', scope: 'project' });
    const paused = unwrap(
      await forProject.agent.run({ conversationId: 'c', projectId, message: 'Remember that.' }),
    );
    const card = ofType(await forProject.events(paused.runId), 'card.sent')
      .map((event) => event.payload.card as Card)
      .find((sent) => sent.type === 'memoryProposal');
    expect(card).toMatchObject({
      scope: { kind: 'project', projectId },
      scopeName: 'Goa trip',
      status: 'pending',
    });

    const forTemplate = setup({ text: 'Captions low.', scope: 'template', templateId });
    const asked = unwrap(await forTemplate.agent.run({ conversationId: 'c', message: 'Remember that.' }));
    const templateCard = ofType(await forTemplate.events(asked.runId), 'card.sent')
      .map((event) => event.payload.card as Card)
      .find((sent) => sent.type === 'memoryProposal');
    expect(templateCard).toMatchObject({
      scope: { kind: 'template', templateId },
      scopeName: 'Sunset montage',
    });
  });
});
