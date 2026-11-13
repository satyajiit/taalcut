// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { newId, type ChatEvent, type ChatHistoryEvent, type ConversationId } from '@taalcut/core';
import { CARD_FIXTURES } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { createFakeChatClient } from '../src/chat/fake-client';
import { SEEDED_CONVERSATION_ID } from '../src/chat/fake-seed';
import { isGone } from '../src/chat/follow-stream';
import { replay, type TranscriptItem } from '../src/chat/transcript';
import { primaryHolder } from '../src/chat/transcript-rows';

/**
 * UX round 1 (W2-5): one waiting line per paused run, the agent's sentence above the question it explains, one
 * marigold primary in the transcript, gone told from broken, and the fake's failures for the failed-answer,
 * failed-message and failed-load states.
 */

const runId = newId<'AgentRun'>();
const conversationId = newId<'Conversation'>() as ConversationId;
const consent = { ...CARD_FIXTURES.consent.pending!, runId, id: 'consent:one' };
const asked: ChatHistoryEvent[] = [
  { type: 'agent.runStarted', at: 1, payload: { runId, conversationId } },
  { type: 'agent.card', at: 2, payload: { runId, card: consent } },
  { type: 'agent.runFinished', at: 3, payload: { runId, status: 'paused' } },
];
const notices = (items: readonly TranscriptItem[]) =>
  items.flatMap((item) => (item.kind === 'notice' ? [item.notice] : []));
const kinds = (items: readonly TranscriptItem[]) =>
  items.map((item) => (item.kind === 'card' ? item.card.type : item.kind));

describe('the transcript, UX round 1', () => {
  it('a paused run that picks up again drops its waiting line, so it never shows twice', () => {
    expect(notices(replay(asked).items)).toEqual(['paused']);
    const resumed = replay([
      ...asked,
      { type: 'agent.runStarted', at: 4, payload: { runId, conversationId } },
      { type: 'agent.card', at: 5, payload: { runId, card: { ...consent, status: 'approved' } } },
      { type: 'agent.runFinished', at: 6, payload: { runId, status: 'paused' } },
    ]);
    expect(notices(resumed.items)).toEqual(['paused']);
    expect(resumed.runs[runId]).toBe('paused');
  });

  it("puts the agent's words above the question they explain, and a reply after an answer under it", () => {
    const messageId = newId<'Message'>();
    const words = (text: string, at: number, id = messageId): ChatEvent => ({
      type: 'agent.messageDelta',
      at,
      payload: { runId, messageId: id, delta: text },
    });
    const live = replay([
      { type: 'agent.runStarted', at: 1, payload: { runId, conversationId } },
      { type: 'agent.card', at: 2, payload: { runId, card: consent } },
      words('Describing this sends one frame. ', 3),
      words('Is that okay?', 4),
    ]);
    expect(kinds(live.items)).toEqual(['agent', 'consent']);
    expect(live.items[0]?.kind === 'agent' && live.items[0].text).toBe(
      'Describing this sends one frame. Is that okay?',
    );
    const answered = replay(
      [
        { type: 'agent.card', at: 5, payload: { runId, card: { ...consent, status: 'approved' } } },
        words('Thanks.', 6, newId<'Message'>()),
      ],
      live,
    );
    expect(kinds(answered.items)).toEqual(['agent', 'consent', 'agent']);
  });

  it('gives the one marigold primary to the newest card that asks, and none when nothing asks', () => {
    const older = { ...CARD_FIXTURES.approval.pending!, runId, id: 'approval:old' };
    const items: TranscriptItem[] = [
      { kind: 'card', key: older.id, card: older },
      { kind: 'agent', key: 'words', runId, text: 'One more thing.', streaming: false, at: 1 },
      { kind: 'card', key: consent.id, card: consent },
    ];
    expect(primaryHolder(items)).toBe('consent:one');
    const settled = items.map((item) =>
      item.kind === 'card' && item.card.type === 'consent'
        ? { ...item, card: { ...consent, status: 'approved' as const } }
        : item,
    );
    expect(primaryHolder(settled)).toBe('approval:old');
    expect(primaryHolder(settled.filter((item) => item.kind !== 'card'))).toBeNull();
  });

  it('tells "deleted" from "broken for now" by the error code', () => {
    const error = (code: string) => ({ code, messageKey: `errors.${code}`, retryable: false });
    expect(isGone(error('core.not_found'))).toBe(true);
    expect(isGone(error('timeline.not_found'))).toBe(true);
    expect(isGone(error('core.process_restarted'))).toBe(false);
    expect(isGone(error('core.timeout'))).toBe(false);
  });
});

describe('the seeded trip chat, as the app would leave it', () => {
  it('has one question open, one waiting line, and the sentence before each card it explains', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 0 });
    const got = await client.getConversation(SEEDED_CONVERSATION_ID);
    if (!got.ok) throw new Error('no seeded chat');
    const { items } = replay(got.value.history);
    expect(notices(items)).toEqual(['paused']);
    expect(primaryHolder(items)).toBe('consent:trip');
    const at = (key: string) => items.findIndex((item) => item.key === key);
    const costWords = items.findIndex((item) => item.kind === 'agent' && item.text.includes('$0.042'));
    expect(costWords).toBeGreaterThan(-1);
    expect(costWords).toBeLessThan(at('cost:trip'));
    const consentWords = items.findIndex((item) => item.kind === 'agent' && item.text.includes('describe'));
    expect(consentWords).toBeLessThan(at('consent:trip'));
    // The cost question was answered "Not now" by the next message: settled, no buttons.
    const cost = items[at('cost:trip')];
    expect(cost?.kind === 'card' && cost.card.type === 'costEstimate' && cost.card.version === 1).toBe(true);
    expect(
      cost?.kind === 'card' &&
        cost.card.type === 'costEstimate' &&
        cost.card.version === 1 &&
        cost.card.requiresApproval,
    ).toBe(false);
  });
});

describe('the fake chat fails on request (failNext)', () => {
  const signal = () => new AbortController().signal;

  it('a load, a send and an answer each fail once as a restart, and then work', async () => {
    const client = createFakeChatClient({ latencyMs: 0, speed: 0 });
    client.failNext('load');
    const load = await client.getConversation(SEEDED_CONVERSATION_ID);
    expect(load.ok ? null : load.error.code).toBe('core.process_restarted');
    expect((await client.getConversation(SEEDED_CONVERSATION_ID)).ok).toBe(true);

    client.failNext('send');
    const message = { conversationId: newId<'Conversation'>(), text: 'Hello' };
    const sent = await client.send(message, { signal: signal() });
    expect(sent.ok ? null : sent.error.code).toBe('core.process_restarted');
    // Nothing was stored, so the same message goes on the next try.
    const history = await client.getConversation(message.conversationId);
    expect(history.ok && history.value.history).toEqual([]);
    expect((await client.send(message, { signal: signal() })).ok).toBe(true);

    const got = await client.getConversation(SEEDED_CONVERSATION_ID);
    if (!got.ok) throw new Error('no seeded chat');
    const card = got.value.history.flatMap((event) =>
      event.type === 'agent.card' && event.payload.card.type === 'consent' ? [event.payload] : [],
    )[0];
    if (!card || card.card.type !== 'consent') throw new Error('no consent card');
    const decision = { runId: card.runId, approvalId: card.card.approvalId, decision: 'approve' as const };
    client.failNext('answer');
    const failed = await client.decideApproval(decision);
    expect(failed.ok ? null : failed.error.code).toBe('core.process_restarted');
    expect((await client.decideApproval(decision)).ok).toBe(true);
  });
});
