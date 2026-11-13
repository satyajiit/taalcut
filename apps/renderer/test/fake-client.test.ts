// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { newId, type ChatEvent, type ConversationId, type RunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeChatClient } from '../src/chat/fake-client';
import { GATE_DEMO_PROMPT } from '../src/chat/fake-script';
import { SEEDED_CONVERSATION_ID } from '../src/chat/fake-seed';

async function collect(events: AsyncIterable<ChatEvent>, onEvent?: (event: ChatEvent) => void) {
  const seen: ChatEvent[] = [];
  for await (const event of events) {
    seen.push(event);
    onEvent?.(event);
  }
  return seen;
}

describe('fake chat client', () => {
  it('streams the gate demo: add a source, probe, describe a frame, answer', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 0 });
    const conversationId = newId<'Conversation'>();
    const sent = await client.send(
      { conversationId, text: GATE_DEMO_PROMPT },
      { signal: new AbortController().signal },
    );
    if (!sent.ok) throw new Error('send failed');
    const events = await collect(sent.value.events);

    expect(events[0]?.type).toBe('agent.runStarted');
    expect(events.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'succeeded' } });
    const tools = events.flatMap((event) => (event.type === 'agent.toolStarted' ? [event.payload.tool] : []));
    expect(tools).toEqual(['library.addSource', 'media.probe', 'vision.describeFrame']);
    expect(events.filter((event) => event.type === 'agent.messageDelta').length).toBeGreaterThan(10);
    expect(events.some((event) => event.type === 'agent.reasoningDelta')).toBe(true);

    // The conversation now exists, titled by its first message, with the run in its history.
    const list = await client.listConversations();
    expect(list.ok && list.value.find((c) => c.id === conversationId)?.title).toBe(
      GATE_DEMO_PROMPT.slice(0, 48),
    );
    const stored = await client.getConversation(conversationId);
    expect(stored.ok && stored.value.history.length).toBe(events.length + 1);
  });

  it('stops when the AbortSignal aborts, ending with a cancelled run', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 40 });
    const abort = new AbortController();
    const sent = await client.send(
      { conversationId: newId<'Conversation'>(), text: GATE_DEMO_PROMPT },
      { signal: abort.signal },
    );
    if (!sent.ok) throw new Error('send failed');
    let deltasAtStop = -1;
    const events = await collect(sent.value.events, (event) => {
      if (event.type === 'agent.messageDelta' && deltasAtStop === -1) {
        deltasAtStop = 1;
        abort.abort();
      }
    });
    expect(events.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'cancelled' } });
    expect(events.filter((event) => event.type === 'agent.messageDelta')).toHaveLength(deltasAtStop);
  });

  it('holdAfter: the run holds after its first event of that type until it is stopped', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 0, holdAfter: 'agent.toolFinished' });
    const abort = new AbortController();
    const sent = await client.send(
      { conversationId: newId<'Conversation'>(), text: GATE_DEMO_PROMPT },
      { signal: abort.signal },
    );
    if (!sent.ok) throw new Error('send failed');
    const seen: string[] = [];
    const done = collect(sent.value.events, (event) => seen.push(event.type));
    // With no waiting at all (speed 0) the run gets to the hold at once, and stays there.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(seen.at(-1)).toBe('agent.toolFinished');
    expect(seen.filter((type) => type === 'agent.toolStarted')).toHaveLength(1);
    abort.abort();
    const events = await done;
    expect(events.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'cancelled' } });
  });

  it('serves seeded conversations and treats an unknown id as a new, empty one', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 0 });
    const seeded = await client.getConversation(SEEDED_CONVERSATION_ID);
    expect(seeded.ok && seeded.value.conversation.title).toBe('Trip to Goa reel');
    expect(seeded.ok && seeded.value.history.length).toBeGreaterThan(20);

    const unknown = await client.getConversation(newId<'Conversation'>() as ConversationId);
    expect(unknown.ok && unknown.value.history).toEqual([]);
    const list = await client.listConversations();
    expect(list.ok && list.value).toHaveLength(3);
  });

  it('answers an approval by resuming the run, which follow streams', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 0 });
    const runId = 'r' as RunId;
    const followed: ChatEvent[] = [];
    const following = (async () => {
      for await (const event of client.follow(runId, { signal: new AbortController().signal }))
        followed.push(event);
    })();
    const decided = await client.decideApproval({ runId, approvalId: 'ap-cost-1', decision: 'approve' });
    expect(decided.ok).toBe(true);
    await following;
    // The run picks up, updates the card in place (same id), says what's next and stops again.
    expect(followed.map((event) => event.type)).toEqual([
      'agent.runStarted',
      'agent.card',
      ...followed.slice(2, -1).map(() => 'agent.messageDelta'),
      'agent.runFinished',
    ]);
    expect(followed[1]).toMatchObject({ payload: { card: { id: 'cost:trip', requiresApproval: false } } });
    const after = await client.getConversation(SEEDED_CONVERSATION_ID);
    expect(after.ok && after.value.history.at(-1)).toMatchObject({
      type: 'agent.runFinished',
      payload: { runId, status: 'succeeded' },
    });
    const missing = await client.decideApproval({ runId, approvalId: 'nope', decision: 'deny' });
    expect(missing.ok).toBe(false);
  });

  it('stops a paused run by id, which follow sees end; again, or once ended, changes nothing', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 0 });
    const seeded = await client.getConversation(SEEDED_CONVERSATION_ID);
    const paused = seeded.ok
      ? seeded.value.history.findLast(
          (event) => event.type === 'agent.runFinished' && event.payload.status === 'paused',
        )
      : undefined;
    if (paused?.type !== 'agent.runFinished') throw new Error('the seeded conversation has no paused run');
    const { runId } = paused.payload;
    const followed = collect(client.follow(runId, { signal: new AbortController().signal }));
    expect(await client.stop(runId)).toEqual({ ok: true, value: { runId, status: 'cancelled' } });
    expect((await followed).map((event) => event.type)).toEqual(['agent.runFinished']);
    expect(await client.stop(runId)).toEqual({ ok: true, value: { runId, status: 'cancelled' } });
    const missing = await client.stop(newId<'AgentRun'>());
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });

  it('stops a playing run by id', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 1 });
    const sent = await client.send(
      { conversationId: newId<'Conversation'>() as ConversationId, text: GATE_DEMO_PROMPT },
      { signal: new AbortController().signal },
    );
    if (!sent.ok) throw new Error(sent.error.code);
    const events = collect(sent.value.events);
    expect(await client.stop(sent.value.runId)).toEqual({
      ok: true,
      value: { runId: sent.value.runId, status: 'cancelled' },
    });
    expect((await events).at(-1)).toMatchObject({
      type: 'agent.runFinished',
      payload: { status: 'cancelled' },
    });
  });

  it('settles a consent card, and "Always allow" arrives as remember', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 0 });
    const runId = 'r' as RunId;
    const decided = await client.decideApproval({
      runId,
      approvalId: 'ap-consent-1',
      decision: 'approve',
      remember: true,
    });
    expect(decided.ok).toBe(true);
    const after = await client.getConversation(SEEDED_CONVERSATION_ID);
    if (!after.ok) throw new Error('get failed');
    const history = after.value.history;
    const consent = history.flatMap((e) =>
      e.type === 'agent.card' && e.payload.card.id === 'consent:trip' ? [e.payload.card] : [],
    );
    expect(consent.at(-1)).toMatchObject({ type: 'consent', status: 'approved' });
    const said = history.flatMap((e) => (e.type === 'agent.messageDelta' ? [e.payload.delta] : [])).join('');
    expect(said).toContain('won’t ask again');
  });

  it('refuses an answer for a run that has ended, as the agent does', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 0 });
    const record = await client.getConversation(SEEDED_CONVERSATION_ID);
    if (!record.ok) throw new Error('get failed');
    const consent = record.value.history.find(
      (e) => e.type === 'agent.card' && e.payload.card.type === 'consent',
    );
    if (consent?.type !== 'agent.card') throw new Error('no consent card');
    const { runId } = consent.payload;
    expect(await client.stop(runId)).toMatchObject({ ok: true, value: { status: 'cancelled' } });
    const refused = await client.decideApproval({ runId, approvalId: 'ap-consent-1', decision: 'approve' });
    expect(refused).toMatchObject({ ok: false, error: { code: 'agent.run_finished' } });
  });
});
