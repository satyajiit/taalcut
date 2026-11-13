// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The chat service (P1-H3 backend): conversations, a message as a streamed
 * run of core `agent.*` events, stop, and approval round trips, with
 * scripted models.
 */
import {
  CancelledError,
  defineTool,
  defineToolModule,
  err,
  newId,
  NO_TOOL_RETRY,
  ok,
  taalcutEventSchema,
  unwrap,
  type ToolModule,
} from '@taalcut/core';
import { createChatService, createMemoryConversationStore } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { call, harness, plan, turns } from './support/harness';

import { setup, collect, texts, countScript } from './support/chat-fixture';

describe('sending a message', () => {
  it('streams core agent events from runStarted to runFinished, and keeps the conversation', async () => {
    const s = setup({ script: countScript });
    const sent = unwrap(
      await s.chat.send(
        { conversationId: s.conversationId, text: 'How many words in "a b c"?' },
        { signal: new AbortController().signal },
      ),
    );
    expect(sent.userMessage).toMatchObject({
      type: 'user.message',
      payload: { conversationId: s.conversationId },
    });
    const events = await collect(sent.events);

    expect(events[0]).toMatchObject({
      type: 'agent.runStarted',
      payload: { runId: sent.runId, conversationId: s.conversationId },
    });
    expect(events.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'succeeded' } });
    expect(events.filter((e) => e.type === 'agent.toolStarted').map((e) => e.payload.tool)).toEqual([
      'clips.countWords',
    ]);
    expect(events.find((e) => e.type === 'agent.toolFinished')).toMatchObject({
      payload: { status: 'succeeded' },
    });
    expect(events.filter((e) => e.type === 'agent.step').map((e) => e.payload.status)).toEqual([
      'running',
      'done',
    ]);
    expect(texts(events)).toEqual(['It has 3 words.']);
    // Everything but reasoning is in core's event catalogue, so it crosses IPC as is.
    for (const event of events) expect(taalcutEventSchema.safeParse(event).success, event.type).toBe(true);

    const list = unwrap(await s.chat.listConversations());
    expect(list).toMatchObject([{ id: s.conversationId, title: 'How many words in "a b c"?' }]);
    const record = unwrap(await s.chat.getConversation(s.conversationId));
    expect(record.history[0]).toEqual(sent.userMessage);
    expect(record.history.slice(1).map((e) => e.type)).toEqual(
      events.map((e) => e.type).filter((t, i, all) => t !== 'agent.messageDelta' || all.indexOf(t) === i),
    );
    expect(texts(record.history)).toEqual(['It has 3 words.']);
    const stored = unwrap(await s.conversations.get(s.conversationId));
    expect(stored.messages.map((m) => [m.role, m.parts, m.runId])).toEqual([
      ['user', [{ type: 'text', text: 'How many words in "a b c"?' }], null],
      ['assistant', [{ type: 'text', text: 'It has 3 words.' }], sent.runId],
    ]);
    expect(stored.runs).toEqual([{ runId: sent.runId }]);
  });

  it('sends the chat’s effort with every model turn, logs it with the run, and keeps it in the history', async () => {
    const s = setup({ script: countScript });
    const sent = unwrap(
      await s.chat.send(
        { conversationId: s.conversationId, text: 'How many words in "a b c"?', effort: 'deep' },
        { signal: new AbortController().signal },
      ),
    );
    const events = await collect(sent.events);
    expect(events[0]).toMatchObject({ type: 'agent.runStarted', payload: { effort: 'deep' } });
    expect(taalcutEventSchema.safeParse(events[0]).success).toBe(true);
    // ModelClient gets the effort on every turn and maps it per model (models' client/thinking.ts).
    expect(s.models.requests.length).toBeGreaterThan(1);
    expect(s.models.requests.every((r) => r.effort === 'deep')).toBe(true);
    const log = await s.events(sent.runId);
    expect(log[0]).toMatchObject({ type: 'run.started', payload: { effort: 'deep' } });
    expect(log.find((e) => e.type === 'model.responded')).toMatchObject({ payload: { reasoning: 'off' } });
    const trace = unwrap(await s.agent.trace(sent.runId));
    expect(trace.spans.find((span) => span.kind === 'run')?.attributes).toMatchObject({ effort: 'deep' });
    expect(trace.spans.find((span) => span.kind === 'model')?.attributes).toMatchObject({ reasoning: 'off' });
    // A reload replays it: the chat shows the effort its last message went with.
    const record = unwrap(await s.chat.getConversation(s.conversationId));
    expect(record.history.find((e) => e.type === 'agent.runStarted')).toMatchObject({
      payload: { effort: 'deep' },
    });

    // Without one, the run thinks at the model's own level.
    const plain = unwrap(
      await s.chat.send(
        { conversationId: s.conversationId, text: 'And now?' },
        { signal: new AbortController().signal },
      ),
    );
    const next = await collect(plain.events);
    expect(next[0]?.payload).not.toHaveProperty('effort');
    expect(s.models.requests.at(-1)).not.toHaveProperty('effort');
  });

  it('sends the exact level a chat picked instead of an effort, logs it, and keeps it in the history (UX3-AGT)', async () => {
    const s = setup({ script: countScript });
    const sent = unwrap(
      await s.chat.send(
        {
          conversationId: s.conversationId,
          text: 'How many words in "a b c"?',
          effort: 'deep',
          reasoning: 'xhigh',
        },
        { signal: new AbortController().signal },
      ),
    );
    const events = await collect(sent.events);
    expect(events[0]).toMatchObject({
      type: 'agent.runStarted',
      payload: { effort: 'deep', reasoning: 'xhigh' },
    });
    expect(taalcutEventSchema.safeParse(events[0]).success).toBe(true);
    // The level replaces the effort on every turn; ModelClient clamps it to each model's levels.
    expect(s.models.requests.every((r) => r.reasoning === 'xhigh' && r.effort === undefined)).toBe(true);
    const log = await s.events(sent.runId);
    expect(log[0]).toMatchObject({ type: 'run.started', payload: { reasoning: 'xhigh' } });
    const trace = unwrap(await s.agent.trace(sent.runId));
    expect(trace.spans.find((span) => span.kind === 'run')?.attributes).toMatchObject({ reasoning: 'xhigh' });
    const record = unwrap(await s.chat.getConversation(s.conversationId));
    expect(record.history.find((e) => e.type === 'agent.runStarted')).toMatchObject({
      payload: { reasoning: 'xhigh' },
    });
  });

  it('moves a chat in no project into the project its first message’s clip chips name, before the run', async () => {
    const h = harness({ script: countScript });
    const projectId = newId<'Project'>();
    const timelineId = newId<'Timeline'>();
    const asked: unknown[] = [];
    const chat = createChatService({
      agent: h.agent,
      conversations: createMemoryConversationStore(),
      linkProject: async (id, selections) => {
        asked.push([id, selections]);
        return selections.some((chip) => chip.kind === 'clip' && chip.timelineId === timelineId)
          ? projectId
          : null;
      },
    });
    const conversationId = newId<'Conversation'>();
    const chip = { kind: 'clip' as const, timelineId, clipId: newId<'TimelineItem'>() };
    const sent = unwrap(
      await chat.send(
        { conversationId, text: 'Make this clip shorter', selections: [chip] },
        { signal: new AbortController().signal },
      ),
    );
    await collect(sent.events);
    expect(asked).toEqual([[conversationId, [chip]]]);
    expect((await h.events(sent.runId))[0]).toMatchObject({ type: 'run.started', payload: { projectId } });

    // A message without chips asks nothing.
    const plain = unwrap(
      await chat.send({ conversationId, text: 'And now?' }, { signal: new AbortController().signal }),
    );
    await collect(plain.events);
    expect(asked).toHaveLength(1);
  });

  it('reads an unknown conversation as new and empty', async () => {
    const s = setup({ script: countScript });
    expect(unwrap(await s.chat.getConversation(s.conversationId))).toMatchObject({
      conversation: { title: '' },
      history: [],
    });
    expect(unwrap(await s.chat.listConversations())).toEqual([]);
    const aborted = await s.chat.send(
      { conversationId: s.conversationId, text: 'hi' },
      { signal: AbortSignal.abort() },
    );
    expect(!aborted.ok && aborted.error.code).toBe('core.cancelled');
  });

  it('detaches on disconnect and stops only on the explicit Stop action', async () => {
    let started = () => {};
    const running = new Promise<void>((resolve) => (started = resolve));
    const slow: ToolModule = defineToolModule({
      id: 'slow',
      tools: [
        defineTool({
          name: 'slow.render',
          version: '1.0.0',
          description: 'Takes a long time unless stopped.',
          input: z.object({}),
          output: z.object({ done: z.boolean() }),
          costClass: 'local',
          sideEffect: 'read',
          timeoutMs: 60_000,
          retry: NO_TOOL_RETRY,
          run: (_input, ctx) =>
            new Promise((resolve) => {
              started();
              ctx.signal.addEventListener('abort', () => resolve(err(CancelledError())), { once: true });
              if (ctx.signal.aborted) resolve(ok({ done: false }));
            }),
        }),
      ],
    });
    const s = setup({
      modules: [slow],
      script: turns(plan('Render'), { toolCalls: [call('slow_render')] }, { text: 'Done.' }),
    });
    const stop = new AbortController();
    const sent = unwrap(
      await s.chat.send({ conversationId: s.conversationId, text: 'render it' }, { signal: stop.signal }),
    );
    const disconnected = collect(sent.events);
    await running;
    stop.abort();
    expect((await disconnected).some((event) => event.type === 'agent.runFinished')).toBe(false);
    const followed = collect(s.chat.follow(sent.runId, { signal: new AbortController().signal }));
    expect(unwrap(await s.chat.stop(sent.runId)).status).toBe('cancelled');
    const events = await followed;
    expect(events.find((e) => e.type === 'agent.toolFinished')).toMatchObject({
      payload: { tool: 'slow.render', status: 'cancelled' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'agent.runFinished', payload: { status: 'cancelled' } });
    const record = unwrap(await s.chat.getConversation(s.conversationId));
    expect(record.history.at(-1)).toMatchObject({
      type: 'agent.runFinished',
      payload: { status: 'cancelled' },
    });
  });
});
