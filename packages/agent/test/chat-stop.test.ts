// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * chat.stop: stopping a run by id once its `send` stream is gone. A live run
 * (here, a tool running after an approval) is cancelled; a paused or
 * interrupted run is marked cancelled, so a restarted agent never resumes it.
 */
import {
  CancelledError,
  defineTool,
  defineToolModule,
  err,
  newId,
  NO_TOOL_RETRY,
  ok,
  unwrap,
  type ToolModule,
} from '@taalcut/core';
import {
  createChatService,
  createMemoryConversationStore,
  createMemoryEventLogStore,
  type ChatEvent,
  type ConversationStore,
  type EventLogStore,
  type ModelScript,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { call, harness, plan, turns, types } from './support/harness';

/** A tool that runs until its signal aborts, or until `finish`. */
function slowPublish(sideEffect: 'destructive' | 'read' = 'destructive') {
  const done = Promise.withResolvers<void>();
  const tool = {
    signals: [] as AbortSignal[],
    started: Promise.withResolvers<void>(),
    finish: () => done.resolve(),
  };
  const module: ToolModule = defineToolModule({
    id: 'slow',
    tools: [
      defineTool({
        name: 'slow.publish',
        version: '1.0.0',
        description: 'Replaces the published master; takes a long time unless stopped.',
        input: z.object({}),
        output: z.object({ done: z.boolean() }),
        costClass: 'local',
        sideEffect,
        // A destructive tool wraps a command; this one never gets as far as dispatching it.
        ...(sideEffect === 'destructive' ? { command: 'slow.publish', idempotencyKey: () => 'master' } : {}),
        timeoutMs: 60_000,
        retry: NO_TOOL_RETRY,
        run: (_input, ctx) =>
          new Promise((resolve) => {
            tool.signals.push(ctx.signal);
            tool.started.resolve();
            ctx.signal.addEventListener('abort', () => resolve(err(CancelledError())), { once: true });
            void done.promise.then(() => resolve(ok({ done: true })));
          }),
      }),
    ],
  });
  return { tool, module };
}

const publishScript = turns(
  plan('Publish'),
  { text: 'I will replace the published master.', toolCalls: [call('slow_publish')] },
  { text: 'Published.' },
);

/** One agent process: an agent and its chat service over the given stores. */
function boot(options: {
  script: ModelScript;
  modules: ToolModule[];
  store: EventLogStore;
  conversations: ConversationStore;
}) {
  const h = harness(options);
  return { ...h, chat: createChatService({ agent: h.agent, conversations: options.conversations }) };
}

async function collect(events: AsyncIterable<ChatEvent>) {
  const seen: ChatEvent[] = [];
  for await (const event of events) seen.push(event);
  return seen;
}

const live = () => ({ signal: new AbortController().signal });

async function pausedOnApproval(s: ReturnType<typeof boot>) {
  const sent = unwrap(
    await s.chat.send({ conversationId: newId<'Conversation'>(), text: 'publish it' }, live()),
  );
  const first = await collect(sent.events);
  expect(first.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'paused' } });
  const asked = first.find((e) => e.type === 'agent.approvalRequested');
  return {
    runId: sent.runId,
    approvalId: asked?.type === 'agent.approvalRequested' ? asked.payload.approvalId : '',
  };
}

describe('chat.stop', () => {
  it('cancels a tool running after an approval, once the send stream is gone; again changes nothing', async () => {
    const { tool, module } = slowPublish();
    const store = createMemoryEventLogStore();
    const s = boot({
      script: publishScript,
      modules: [module],
      store,
      conversations: createMemoryConversationStore(),
    });
    const { runId, approvalId } = await pausedOnApproval(s);

    const followed = collect(s.chat.follow(runId, live()));
    const answered = s.chat.decideApproval({ runId, approvalId, decision: 'approve' });
    await tool.started.promise;
    expect(await s.chat.stop(runId)).toEqual(ok({ runId, status: 'cancelled' }));
    expect(tool.signals.map((signal) => signal.aborted)).toEqual([true]);
    // The answer resolves when the run stops; the follower sees how.
    expect(await answered).toEqual(ok(undefined));
    const events = await followed;
    expect(events.find((e) => e.type === 'agent.toolFinished')).toMatchObject({
      payload: { tool: 'slow.publish', status: 'cancelled' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'cancelled' } });

    expect(await s.chat.stop(runId)).toEqual(ok({ runId, status: 'cancelled' }));
    expect(types(await s.events(runId)).filter((t) => t === 'run.cancelled')).toHaveLength(1);
    expect(unwrap(await store.openRuns())).toEqual([]);
  });

  it('marks a paused run cancelled: after a restart it does not resume, and its question no longer takes an answer', async () => {
    const store = createMemoryEventLogStore();
    const conversations = createMemoryConversationStore();
    const before = boot({ script: publishScript, modules: [slowPublish().module], store, conversations });
    const { runId, approvalId } = await pausedOnApproval(before);
    before.chat.close();

    // The app restarts; the run waits on the user, so nothing in this process drives it.
    const { tool, module } = slowPublish();
    const after = boot({ script: publishScript, modules: [module], store, conversations });
    expect(unwrap(await store.openRuns())).toEqual([runId]);
    expect(await after.chat.stop(runId)).toEqual(ok({ runId, status: 'cancelled' }));
    expect(await after.chat.stop(runId)).toEqual(ok({ runId, status: 'cancelled' }));
    expect(types(await after.events(runId)).slice(-2)).toEqual(['tool.failed', 'run.cancelled']);

    const again = boot({ script: publishScript, modules: [module], store, conversations });
    expect(unwrap(await again.agent.recoverInterrupted())).toEqual([]);
    expect(unwrap(await store.openRuns())).toEqual([]);
    const answer = await again.chat.decideApproval({ runId, approvalId, decision: 'approve' });
    expect(!answer.ok && answer.error.code).toBe('agent.run_finished');
    expect(tool.signals).toEqual([]);
    const history = unwrap(
      await again.chat.getConversation(unwrap(await conversations.list())[0]!.id),
    ).history;
    expect(history.filter((e) => e.type === 'agent.runFinished').map((e) => e.payload.status)).toEqual([
      'paused',
      'cancelled',
    ]);
  });

  it('marks an interrupted run cancelled, so start-up recovery skips it; an unknown run is not found', async () => {
    const memory = createMemoryEventLogStore();
    // A process that dies mid-tool: from the kill on, nothing it writes reaches the log.
    let killed = false;
    const dying: EventLogStore = {
      append: (...args) => (killed ? new Promise(() => {}) : memory.append(...args)),
      read: (...args) => memory.read(...args),
      openRuns: () => memory.openRuns(),
    };
    const { tool, module } = slowPublish('read');
    const conversations = createMemoryConversationStore();
    const before = boot({ script: publishScript, modules: [module], store: dying, conversations });
    const sent = unwrap(
      await before.chat.send({ conversationId: newId<'Conversation'>(), text: 'publish it' }, live()),
    );
    await tool.started.promise;
    killed = true;
    tool.finish(); // Its result is never logged.

    const after = boot({
      script: publishScript,
      modules: [slowPublish('read').module],
      store: memory,
      conversations,
    });
    expect(unwrap(await memory.openRuns())).toEqual([sent.runId]);
    expect(await after.chat.stop(sent.runId)).toEqual(ok({ runId: sent.runId, status: 'cancelled' }));
    expect(unwrap(await after.agent.recoverInterrupted())).toEqual([]);
    expect(types(unwrap(await memory.read(sent.runId))).at(-1)).toBe('run.cancelled');

    const unknown = await after.chat.stop(newId<'AgentRun'>());
    expect(!unknown.ok && unknown.error.code).toBe('core.not_found');
  });
});
