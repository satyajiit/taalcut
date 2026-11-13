// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The chat service (P1-H3 backend): conversations, a message as a streamed
 * run of core `agent.*` events, stop, and approval round trips, with
 * scripted models.
 */
import { taalcutEventSchema, unwrap } from '@taalcut/core';
import { type ChatHistoryEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';

import { clipsModule, gateDemoModules } from './support/fixtures';
import { call, plan, turns } from './support/harness';

import { setup, collect, texts } from './support/chat-fixture';

describe('approvals', () => {
  const deleteScript = turns(
    plan('Delete the blurry clip'),
    { text: 'I will move clip c1 to the Trash.', toolCalls: [call('clips_deleteClip', { id: 'c1' })] },
    { text: 'Deleted.' },
  );

  it('asks, pauses, and continues after the answer; follow streams the continuation', async () => {
    const s = setup({ script: deleteScript });
    const sent = unwrap(
      await s.chat.send(
        { conversationId: s.conversationId, text: 'delete c1' },
        { signal: new AbortController().signal },
      ),
    );
    const first = await collect(sent.events);
    const asked = first.find((e) => e.type === 'agent.approvalRequested');
    expect(asked?.payload).toMatchObject({
      tool: 'clips.deleteClip',
      sideEffect: 'destructive',
      reason: 'I will move clip c1 to the Trash.',
    });
    expect(first.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'paused' } });
    expect(s.applied).toEqual([]);

    const followed = collect(s.chat.follow(sent.runId, { signal: new AbortController().signal }));
    const approvalId = asked!.type === 'agent.approvalRequested' ? asked!.payload.approvalId : '';
    unwrap(await s.chat.decideApproval({ runId: sent.runId, approvalId, decision: 'approve' }));
    expect(s.applied.map((a) => a.command)).toEqual(['clips.deleteClip']);
    const live = await followed;
    expect(live.map((e) => e.type)).toEqual(
      expect.arrayContaining(['agent.card', 'agent.runStarted', 'agent.toolFinished']),
    );
    expect(live.find((e) => e.type === 'agent.card')).toMatchObject({
      payload: { card: { type: 'approval', status: 'approved', approvalId } },
    });
    expect(live.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'succeeded' } });

    const history = unwrap(await s.chat.getConversation(s.conversationId)).history;
    expect(history.filter((e) => e.type === 'agent.runFinished').map((e) => e.payload.status)).toEqual([
      'paused',
      'succeeded',
    ]);
    expect(texts(history)).toEqual(['I will move clip c1 to the Trash.', 'Deleted.']);
  });

  it('skips the call when denied, and says the approval is unknown when it is', async () => {
    const s = setup({ script: deleteScript });
    const sent = unwrap(
      await s.chat.send(
        { conversationId: s.conversationId, text: 'delete c1' },
        { signal: new AbortController().signal },
      ),
    );
    const asked = (await collect(sent.events)).find((e) => e.type === 'agent.approvalRequested');
    const approvalId = asked?.type === 'agent.approvalRequested' ? asked.payload.approvalId : '';
    unwrap(await s.chat.decideApproval({ runId: sent.runId, approvalId, decision: 'deny' }));
    const history = unwrap(await s.chat.getConversation(s.conversationId)).history;
    expect(history.find((e) => e.type === 'agent.toolFinished')).toMatchObject({
      payload: { status: 'cancelled' },
    });
    expect(s.applied).toEqual([]);
    const again = await s.chat.decideApproval({ runId: sent.runId, approvalId, decision: 'approve' });
    expect(!again.ok && again.error.code).toBe('agent.approval_unknown');
    // Following a finished run ends at once.
    expect(await collect(s.chat.follow(sent.runId, { signal: new AbortController().signal }))).toEqual([]);
  });

  it('shows a budget stop as budgetExceeded and a cost card that settles when approved', async () => {
    const script = turns(
      plan('Describe a frame'),
      { toolCalls: [call('vision_describeFrame', { path: '/Trip/a.mov', atSeconds: 1 })] },
      { text: 'A beach.' },
    );
    const s = setup({ modules: gateDemoModules(), script, settings: { budget: { maxUsd: 0.001 } } });
    const sent = unwrap(
      await s.chat.send(
        { conversationId: s.conversationId, text: 'describe' },
        { signal: new AbortController().signal },
      ),
    );
    const first = await collect(sent.events);
    expect(first.find((e) => e.type === 'agent.budgetExceeded')).toMatchObject({
      payload: { budget: 'money', limit: 1000 },
    });
    const card = first.find((e) => e.type === 'agent.card');
    // The first stop is before the first model call (estimated at the default price).
    expect(card).toMatchObject({
      payload: {
        card: { type: 'costEstimate', requiresApproval: true, estimate: { money: { currency: 'USD' } } },
      },
    });
    const approvalId =
      card?.type === 'agent.card' && card.payload.card.type === 'costEstimate'
        ? card.payload.card.approvalId!
        : '';
    unwrap(await s.chat.decideApproval({ runId: sent.runId, approvalId, decision: 'approve' }));
    const history = unwrap(await s.chat.getConversation(s.conversationId)).history;
    const cards = history.flatMap((e) =>
      e.type === 'agent.card' &&
      e.payload.card.type === 'costEstimate' &&
      e.payload.card.version === 1 &&
      e.payload.card.id === approvalId
        ? [e.payload.card.requiresApproval]
        : [],
    );
    expect(cards).toEqual([true, false]);
    // The cloud tool's own estimate is the next stop.
    expect(history.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'paused' } });
    s.chat.close();
  });

  describe('uploads', () => {
    const lookScript = turns(
      plan('Look'),
      { toolCalls: [call('vision_describeFrame', { path: '/Trip/a.mov', atSeconds: 1 })] },
      { text: 'A beach.' },
    );
    async function uploadSetup() {
      const { cloudVisionModule } = await import('./support/fixtures');
      return setup({
        modules: [clipsModule(), cloudVisionModule()],
        script: lookScript,
        deps: { cloudProviders: (module) => (module === 'vision' ? ['google', 'anthropic'] : []) },
      });
    }
    const consentCards = (events: readonly ChatHistoryEvent[]) =>
      events.flatMap((e) =>
        e.type === 'agent.card' && e.payload.card.type === 'consent' ? [e.payload.card] : [],
      );
    const look = async (s: Awaited<ReturnType<typeof uploadSetup>>) => {
      const sent = unwrap(
        await s.chat.send(
          { conversationId: s.conversationId, text: 'look' },
          { signal: new AbortController().signal },
        ),
      );
      return { sent, events: await collect(sent.events) };
    };

    it('asks with a consent card: what leaves, to which providers, at what cost, and three answers', async () => {
      const s = await uploadSetup();
      const { sent, events } = await look(s);
      expect(events.find((e) => e.type === 'agent.approvalRequested')).toBeUndefined();
      expect(events.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'paused' } });
      const [card] = consentCards(events);
      expect(card).toEqual({
        type: 'consent',
        id: card!.approvalId,
        version: 1,
        runId: sent.runId,
        approvalId: card!.approvalId,
        tool: 'vision.describeFrame',
        upload: {
          modules: ['vision'],
          providers: ['anthropic', 'google'],
          files: ['/Trip/a.mov'],
          sources: ['user-media'],
        },
        estimate: { money: { currency: 'USD', micros: 4000 }, tokens: 1500 },
        options: ['allow-once', 'always-allow', 'deny'],
        status: 'pending',
      });
      // Core's card, so it crosses IPC and the renderer draws it as is.
      for (const event of events) expect(taalcutEventSchema.safeParse(event).success, event.type).toBe(true);
    });

    it('passes Always allow through; the card settles and the next upload in the conversation goes ahead unasked', async () => {
      const s = await uploadSetup();
      const { sent, events } = await look(s);
      const approvalId = consentCards(events)[0]!.approvalId;
      unwrap(
        await s.chat.decideApproval({ runId: sent.runId, approvalId, decision: 'approve', remember: true }),
      );
      const granted = (await s.events(sent.runId)).find((e) => e.type === 'approval.granted');
      expect(granted?.type === 'approval.granted' && granted.payload.consentIds).toHaveLength(1);
      const history = unwrap(await s.chat.getConversation(s.conversationId)).history;
      expect(consentCards(history).map((c) => [c.approvalId, c.status])).toEqual([
        [approvalId, 'pending'],
        [approvalId, 'approved'],
      ]);

      const again = await look(s);
      expect(again.events.at(-1)).toMatchObject({
        type: 'agent.runFinished',
        payload: { status: 'succeeded' },
      });
      expect(consentCards(again.events)).toEqual([]);
      expect(again.events.find((e) => e.type === 'agent.approvalRequested')).toBeUndefined();
      expect(again.events.find((e) => e.type === 'agent.toolFinished')).toMatchObject({
        payload: { tool: 'vision.describeFrame', status: 'succeeded' },
      });
    });

    it('settles the card as denied on Don’t send, and asks again next time after Allow once', async () => {
      const s = await uploadSetup();
      const first = await look(s);
      unwrap(
        await s.chat.decideApproval({
          runId: first.sent.runId,
          approvalId: consentCards(first.events)[0]!.approvalId,
          decision: 'deny',
        }),
      );
      const history = unwrap(await s.chat.getConversation(s.conversationId)).history;
      expect(consentCards(history).map((c) => c.status)).toEqual(['pending', 'denied']);

      const second = await look(s);
      const [card] = consentCards(second.events);
      unwrap(
        await s.chat.decideApproval({
          runId: second.sent.runId,
          approvalId: card!.approvalId,
          decision: 'approve',
        }),
      );
      expect(consentCards((await look(s)).events)).toMatchObject([{ status: 'pending' }]);
    });
  });
});
