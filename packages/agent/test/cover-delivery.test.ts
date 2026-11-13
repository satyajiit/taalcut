// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  ConflictError,
  coverExportPayloadSchema,
  coverExportResultSchema,
  createCommandBus,
  createMemoryAuditLogStore,
  defineCommand,
  defineTool,
  defineToolModule,
  err,
  newId,
  NO_TOOL_RETRY,
  ok,
  unwrap,
} from '@taalcut/core';
import {
  createChatService,
  createCommandDispatcher,
  createMemoryConversationStore,
  createMemoryEventLogStore,
} from '@taalcut/agent';
import { expect, it, vi } from 'vitest';
import { withCoverDelivery } from '../src/cover-delivery';
import { RunLog } from '../src/run-log';
import { call, harness, plan, turns } from './support/harness';
import { collect } from './support/chat-fixture';

const request = {
  projectId: newId<'Project'>(),
  timelineId: newId<'Timeline'>(),
  revision: 41,
  aspect: '9:16' as const,
};
const receipt = {
  fileName: 'Airport cover.jpg',
  assetId: newId<'Asset'>(),
  width: 1080,
  height: 1920,
  revision: 41,
};

function commandFixture(fail = false) {
  const audit = createMemoryAuditLogStore();
  const bus = createCommandBus({ store: audit, clock: { now: Date.now } });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  bus.register(
    defineCommand({
      name: 'render.exportCover',
      payload: coverExportPayloadSchema,
      sideEffect: 'write',
      handle: async () => {
        entered.resolve();
        await release.promise;
        return fail
          ? err(ConflictError({ entity: 'cover', id: request.timelineId }))
          : ok({ result: receipt });
      },
    }),
  );
  return { audit, entered, release, commands: createCommandDispatcher(bus) };
}

function chatFixture(fail = false) {
  const commands = commandFixture(fail);
  const module = defineToolModule({
    id: 'render',
    tools: [
      defineTool({
        name: 'render.exportCover',
        command: 'render.exportCover',
        version: '1.0.0',
        description: 'Exports the saved cover.',
        input: coverExportPayloadSchema,
        output: coverExportResultSchema,
        costClass: 'local',
        sideEffect: 'write',
        timeoutMs: 5_000,
        retry: NO_TOOL_RETRY,
        idempotencyKey: () => 'cover',
        run: async (input, context) => {
          const done = await context.dispatch(input);
          return done.ok ? ok(coverExportResultSchema.parse(done.value)) : done;
        },
      }),
    ],
  });
  const h = harness({
    modules: [module],
    deps: { commands: commands.commands },
    script: turns(
      plan('Save the cover'),
      { toolCalls: [call('render_exportCover', request)] },
      { text: 'Saved.' },
    ),
  });
  const conversations = createMemoryConversationStore();
  const changed = Promise.withResolvers<void>();
  const onChanged = vi.fn(() => changed.resolve());
  const chat = createChatService({ agent: h.agent, conversations, onConversationChanged: onChanged });
  const conversationId = newId<'Conversation'>();
  return { ...commands, ...h, conversations, changed, onChanged, chat, conversationId };
}

it('delivers the normal cover only after the command is committed', async () => {
  const s = chatFixture();
  const sent = unwrap(
    await s.chat.send(
      { conversationId: s.conversationId, text: 'Save the cover.' },
      { signal: new AbortController().signal },
    ),
  );
  const finished = collect(sent.events);
  await s.entered.promise;
  expect(s.audit.entries()).toEqual([]);
  expect((await s.events(sent.runId)).filter((e) => e.type === 'card.sent')).toEqual([]);
  s.release.resolve();
  const events = await finished;
  const cards = events.filter((e) => e.type === 'agent.card' && e.payload.card.type === 'toolRun');
  expect(cards).toHaveLength(1);
  expect(cards[0]).toMatchObject({ payload: { card: { savedCover: receipt, status: 'succeeded' } } });
  expect(s.audit.entries()).toHaveLength(1);
  expect(s.onChanged).not.toHaveBeenCalled();
  s.chat.close();
});

it('keeps a late committed cover in cancelled chat history and invalidates the closed stream', async () => {
  const s = chatFixture();
  const sent = unwrap(
    await s.chat.send(
      { conversationId: s.conversationId, text: 'Save the cover.' },
      { signal: new AbortController().signal },
    ),
  );
  const finished = collect(sent.events);
  await s.entered.promise;
  unwrap(await s.chat.stop(sent.runId));
  expect((await finished).at(-1)).toMatchObject({
    type: 'agent.runFinished',
    payload: { status: 'cancelled' },
  });
  expect(s.audit.entries()).toHaveLength(0);
  const modelsBeforeCommit = s.models.requests.length;
  s.release.resolve();
  await s.changed.promise;
  expect(s.audit.entries()).toHaveLength(1);
  expect(s.onChanged).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: s.conversationId }));
  const log = await s.events(sent.runId);
  expect(log.at(-1)).toMatchObject({ type: 'card.sent', payload: { card: { savedCover: receipt } } });
  expect(log.filter((e) => e.type === 'run.completed')).toHaveLength(0);
  expect(unwrap(await s.agent.wait(sent.runId)).status).toBe('cancelled');
  expect(unwrap(await s.agent.recoverInterrupted())).toEqual([]);
  expect(s.models.requests).toHaveLength(modelsBeforeCommit);
  const reloaded = createChatService({ agent: s.agent, conversations: s.conversations });
  const history = unwrap(await reloaded.getConversation(s.conversationId)).history;
  expect(history.at(-1)).toMatchObject({
    type: 'agent.card',
    payload: { card: { savedCover: receipt, status: 'succeeded' } },
  });
  expect(await collect(reloaded.follow(sent.runId, { signal: new AbortController().signal }))).toEqual([]);
  reloaded.close();
  s.chat.close();
});

it('does not deliver a cover when its command fails', async () => {
  const s = chatFixture(true);
  s.release.resolve();
  const run = unwrap(await s.agent.start({ conversationId: s.conversationId, message: 'Save the cover.' }));
  unwrap(await s.agent.wait(run));
  expect(s.audit.entries()).toHaveLength(0);
  expect((await s.events(run)).filter((e) => e.type === 'card.sent')).toHaveLength(0);
  s.chat.close();
});

it('skips commands cancelled before dispatch and deduplicates a repeated committed receipt', async () => {
  const s = commandFixture();
  const runId = newId<'AgentRun'>();
  const toolCallId = newId<'ToolRun'>();
  const log = unwrap(await RunLog.open(createMemoryEventLogStore(), runId, () => 100));
  unwrap(
    await log.append([
      'tool.requested',
      {
        toolCallId,
        tool: 'render.exportCover',
        input: request,
        sideEffect: 'write',
        modelCallId: 'model',
        modelToolCallId: 'call',
        callName: 'render_exportCover',
        meta: false,
      },
    ]),
  );
  const commands = withCoverDelivery(
    s.commands,
    () => log,
    () => 200,
  );
  const meta = {
    source: 'agent' as const,
    runId,
    toolCallId,
    tool: 'render.exportCover',
    idempotencyKey: 'cover',
  };
  const cancelled = await commands.dispatch('render.exportCover', request, {
    ...meta,
    signal: AbortSignal.abort(),
  });
  expect(cancelled).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
  expect(s.audit.entries()).toHaveLength(0);
  expect(log.state.cards).toEqual({});
  s.release.resolve();
  unwrap(await commands.dispatch('render.exportCover', request, meta));
  unwrap(await commands.dispatch('render.exportCover', request, meta));
  expect(s.audit.entries()).toHaveLength(1);
  expect(log.events.filter((e) => e.type === 'card.sent')).toHaveLength(1);
  expect(log.state.cards[`cover:${toolCallId}`]).toMatchObject({ savedCover: receipt });
});
