// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A whole flow through the chat service (SPEC sections 13 and 17): every
 * event crosses IPC as core's catalogue has it, the step cards keep their
 * ids, the question is the cast board itself, the one approval is the
 * export card (pending → exporting → exported) and the history replays the
 * same cards for a reloaded window.
 */
import { chatHistoryEventSchema, newId, ok, taalcutEventSchema, unwrap, type Card } from '@taalcut/core';
import {
  createChatService,
  createMemoryConversationStore,
  type ChatEvent,
  type ChatHistoryEvent,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { flowHarness } from './support/flow-harness';
import { flowScript } from './support/flow-script';
import { createWorld } from './support/flow-world';

async function collect(events: AsyncIterable<ChatEvent>) {
  const seen: ChatEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}
const cardsOf = (events: readonly (ChatEvent | ChatHistoryEvent)[]): Card[] =>
  events.flatMap((e) => (e.type === 'agent.card' ? [e.payload.card] : []));

describe('a flow through chat', () => {
  it('creates its project with a clean subject from the full request', async () => {
    const names: string[] = [];
    const h = flowHarness({
      script: flowScript(),
      deps: {
        projects: {
          forConversation: async (_id, { name }) => {
            names.push(name);
            return ok(newId<'Project'>());
          },
        },
      },
    });
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const url = `https://www.instagram.com/reel/example/?tracking=${'x'.repeat(80)}`;
    const sent = unwrap(
      await chat.send(
        {
          conversationId: newId<'Conversation'>(),
          text: `lets create from ${url} , we can use our airport, plan and related shots .`,
          start: { path: 'reference', reference: { kind: 'link', url } },
        },
        { signal: new AbortController().signal },
      ),
    );
    await collect(sent.events);
    expect(names).toEqual(['Airport, plan and related shots']);
    chat.close();
  });

  it('streams catalogue events only, with stable card ids, to the export', async () => {
    const world = createWorld();
    const h = flowHarness({
      world,
      script: flowScript(),
      deps: { projects: { forConversation: async () => ok(world.projectId) } },
    });
    const chat = createChatService({ agent: h.agent, conversations: createMemoryConversationStore() });
    const signal = new AbortController().signal;
    const conversationId = newId<'Conversation'>();
    const sent = unwrap(
      await chat.send(
        {
          conversationId,
          text: 'Copy this',
          start: { path: 'reference', reference: { kind: 'link', url: 'https://www.instagram.com/reel/c/' } },
        },
        { signal },
      ),
    );
    expect(sent.userMessage.payload).toMatchObject({ start: { path: 'reference' } });
    const asked = await collect(sent.events);
    const board = cardsOf(asked).find((c) => c.type === 'castBoard');
    const approvalId = board?.type === 'castBoard' ? board.asking!.approvalId : '';

    const answering = collect(chat.follow(sent.runId, { signal }));
    unwrap(
      await chat.decideApproval({
        runId: sent.runId,
        approvalId,
        decision: 'approve',
        answer: { kind: 'variants', count: 1 },
      }),
    );
    const toExport = await answering;
    const exportCard = cardsOf(toExport).find((c) => c.type === 'exportApproval');
    expect(exportCard).toMatchObject({ status: 'pending', projectId: world.projectId });

    const exporting = collect(chat.follow(sent.runId, { signal }));
    unwrap(
      await chat.decideApproval({
        runId: sent.runId,
        approvalId: exportCard!.type === 'exportApproval' ? exportCard!.approvalId : '',
        decision: 'approve',
      }),
    );
    const done = await exporting;
    expect(done.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'succeeded' } });

    const all = [...asked, ...toExport, ...done];
    for (const event of all)
      expect(
        taalcutEventSchema.safeParse(event).success,
        `${event.type} ${JSON.stringify(event.payload).slice(0, 200)}`,
      ).toBe(true);
    const exportStatuses = cardsOf(all)
      .filter((c) => c.id === exportCard!.id)
      .map((c) => (c.type === 'exportApproval' ? c.status : c.type));
    expect(exportStatuses).toEqual(['pending', 'exporting', 'exported']);
    expect(cardsOf(done).map((c) => c.type)).toEqual(
      expect.arrayContaining(['renderProgress', 'openingChoices']),
    );
    // One card per step, re-sent under its own id: no card id belongs to two types.
    const types = new Map<string, Set<string>>();
    for (const c of cardsOf(all)) types.set(c.id, (types.get(c.id) ?? new Set()).add(c.type));
    for (const [id, set] of types) expect(set.size, id).toBe(1);
    // The opening card's start shows no tool rows for the agent's own export call.
    expect(
      all
        .filter((e) => e.type === 'agent.toolStarted')
        .map((e) => e.type === 'agent.toolStarted' && e.payload.tool),
    ).not.toContain('render.export');

    const history = unwrap(await chat.getConversation(conversationId)).history;
    for (const event of history)
      expect(chatHistoryEventSchema.safeParse(event).success, event.type).toBe(true);
    expect(
      cardsOf(history)
        .filter((c) => c.type === 'exportApproval')
        .at(-1),
    ).toMatchObject({ status: 'exported' });
    chat.close();
  });
});
