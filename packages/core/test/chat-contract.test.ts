// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The chat contract over a real port: a ChatService served with chatRouter,
 * and the renderer's side built with chatClientOverRpc. Sending streams the
 * run (reasoning included), cancelling the stream stops the run, `stop` stops
 * one by id, and every failure comes back as a Result.
 */
import { describe, expect, it } from 'vitest';
import {
  chatClientOverRpc,
  chatContract,
  chatRouter,
  connectRpc,
  err,
  newId,
  NotFoundError,
  ok,
  serveRpc,
  type ApprovalDecision,
  type ChatEvent,
  type ChatService,
  type ConversationId,
  type RunId,
  type UserMessageEvent,
} from '@taalcut/core';
import { channel, tick } from './helpers/ports';

const conversationId = newId<'Conversation'>();
const runId = newId<'AgentRun'>();
const messageId = newId<'Message'>();

const userMessage: UserMessageEvent = {
  type: 'user.message',
  at: 1,
  payload: { messageId, conversationId, text: 'Make a reel' },
};

const run = (id: RunId): ChatEvent[] => [
  { type: 'agent.runStarted', at: 2, payload: { runId: id, conversationId } },
  { type: 'agent.reasoningDelta', at: 3, payload: { runId: id, delta: 'Looking at the folder' } },
  { type: 'agent.messageDelta', at: 4, payload: { runId: id, messageId, delta: 'Done.' } },
  { type: 'agent.runFinished', at: 5, payload: { runId: id, status: 'succeeded' } },
];

function fakeChat() {
  const decisions: ApprovalDecision[] = [];
  const stopped: RunId[] = [];
  let hold = false;
  const service: ChatService = {
    listConversations: async () => ok([{ id: conversationId, title: 'Trip', createdAt: 1, updatedAt: 5 }]),
    getConversation: async (id: ConversationId) =>
      id === conversationId
        ? ok({
            conversation: {
              id,
              title: 'Trip',
              createdAt: 1,
              updatedAt: 5,
              preview: 'Done.',
              archived: false,
            },
            history: [userMessage, ...run(runId)],
          })
        : err(NotFoundError({ entity: 'conversation', id })),
    async send(input, { signal }) {
      if (input.text === 'fail') return err(NotFoundError({ entity: 'conversation' }));
      async function* events(): AsyncGenerator<ChatEvent> {
        const [started, ...rest] = run(runId);
        yield started!;
        while (hold && !signal.aborted) await tick(5);
        if (signal.aborted) {
          stopped.push(runId);
          return;
        }
        yield* rest;
      }
      return ok({ runId, userMessage, events: events() });
    },
    async decideApproval(input) {
      decisions.push(input);
      return ok(undefined);
    },
    async *follow(id) {
      yield* run(id).slice(1);
    },
    async stop(id) {
      if (id !== runId) return err(NotFoundError({ entity: 'run', id }));
      stopped.push(id);
      return ok({ runId: id, status: 'cancelled' });
    },
  };
  return {
    service,
    decisions,
    stopped,
    holdRuns: () => {
      hold = true;
    },
  };
}

function connect(service: ChatService) {
  const { port1, port2 } = channel();
  serveRpc(chatRouter(service), port1, { context: {} });
  return chatClientOverRpc(connectRpc(chatContract, port2, { peer: 'agent' }).client);
}

async function collect(events: AsyncIterable<ChatEvent>): Promise<string[]> {
  const types: string[] = [];
  for await (const event of events) types.push(event.type);
  return types;
}

describe('chat over IPC', () => {
  it('lists and reads conversations; an unknown one is a typed error', async () => {
    const chat = connect(fakeChat().service);
    expect(await chat.listConversations()).toMatchObject({ ok: true, value: [{ id: conversationId }] });
    const record = await chat.getConversation(conversationId);
    expect(record.ok && record.value.history.map((event) => event.type)).toEqual([
      'user.message',
      'agent.runStarted',
      'agent.reasoningDelta',
      'agent.messageDelta',
      'agent.runFinished',
    ]);
    const missing = await chat.getConversation(newId<'Conversation'>());
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });

  it('sends: the run id and stored message first, then the run until it finishes', async () => {
    const chat = connect(fakeChat().service);
    const sent = await chat.send(
      { conversationId, text: 'Make a reel' },
      { signal: new AbortController().signal },
    );
    if (!sent.ok) throw new Error(sent.error.code);
    expect(sent.value.runId).toBe(runId);
    expect(sent.value.userMessage).toEqual(userMessage);
    expect(await collect(sent.value.events)).toEqual([
      'agent.runStarted',
      'agent.reasoningDelta',
      'agent.messageDelta',
      'agent.runFinished',
    ]);
    const failed = await chat.send(
      { conversationId, text: 'fail' },
      { signal: new AbortController().signal },
    );
    expect(!failed.ok && failed.error.code).toBe('core.not_found');
  });

  it('stops the run when the stream is cancelled', async () => {
    const fake = fakeChat();
    fake.holdRuns();
    const chat = connect(fake.service);
    const controller = new AbortController();
    const sent = await chat.send({ conversationId, text: 'Make a reel' }, { signal: controller.signal });
    if (!sent.ok) throw new Error(sent.error.code);
    const reading = collect(sent.value.events).catch(() => ['stopped']);
    await tick(20);
    controller.abort();
    await reading;
    await tick(30);
    expect(fake.stopped).toEqual([runId]);
  });

  it('passes approval answers through, with remember, and follows a run after one', async () => {
    const fake = fakeChat();
    const chat = connect(fake.service);
    const answer = { runId, approvalId: 'ap-1', decision: 'approve' as const, remember: true };
    expect(await chat.decideApproval(answer)).toEqual({ ok: true, value: undefined });
    expect(fake.decisions).toEqual([answer]);
    const rest = await collect(chat.follow(runId, { signal: new AbortController().signal }));
    expect(rest).toEqual(['agent.reasoningDelta', 'agent.messageDelta', 'agent.runFinished']);
    const bad = await chat.decideApproval({ ...answer, approvalId: '' });
    expect(!bad.ok && bad.error.code).toBe('core.validation');
  });

  it('stops a run by id, with its status; an unknown run is a typed error', async () => {
    const fake = fakeChat();
    const chat = connect(fake.service);
    expect(await chat.stop(runId)).toEqual({ ok: true, value: { runId, status: 'cancelled' } });
    expect(fake.stopped).toEqual([runId]);
    const unknown = await chat.stop(newId<'AgentRun'>());
    expect(!unknown.ok && unknown.error.code).toBe('core.not_found');
    const bad = await chat.stop('not-a-run' as RunId);
    expect(!bad.ok && bad.error.code).toBe('core.validation');
  });
});
