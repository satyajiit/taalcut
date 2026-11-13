// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V4's external runner: an MCP session's calls run as one external run (no model loop) under the agent's
 * policy plus the session's level, with the session's origin on every command and approval cards that say
 * who asked; a deferred call answers pending and resumes under the same key; revoking ends the run.
 */
import {
  cardSchema,
  createCommandBus,
  createMemoryAuditLogStore,
  defineCommand,
  newId,
  ok,
  unwrap,
  type McpSessionId,
  type RunId,
} from '@taalcut/core';
import {
  createCommandDispatcher,
  createExternalRunner,
  createMemoryConversationStore,
  createMemoryEventLogStore,
  type CommandDispatchMeta,
  type CommandDispatcher,
  type EventLogStore,
  type ExternalCallOptions,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { harness, ofType, turns } from '../support/harness';

const SESSION = {
  sessionId: newId<'McpSession'>() satisfies McpSessionId,
  name: 'Claude Code',
  client: 'claude-code' as const,
};

function world(options: { store?: EventLogStore; localOnly?: () => boolean } = {}) {
  const dispatched: { command: string; meta: CommandDispatchMeta }[] = [];
  const commands: CommandDispatcher = {
    async dispatch(command, _payload, meta) {
      dispatched.push({ command, meta });
      return ok({ applied: true });
    },
  };
  const h = harness({
    script: turns({ text: 'No model runs in an external run.' }),
    ...(options.store ? { store: options.store } : {}),
    settings: { autonomy: 'before-render' },
    deps: { commands },
  });
  const conversations = createMemoryConversationStore();
  const runner = createExternalRunner({
    host: h.agent.external(),
    conversations,
    tickMs: 5,
    ...(options.localOnly ? { localOnly: options.localOnly } : {}),
  });
  return { ...h, runner, conversations, dispatched };
}

const opts = (callKey: string, extra: Partial<ExternalCallOptions> = {}): ExternalCallOptions => ({
  callKey,
  level: 'edit',
  origin: { source: 'mcp', actor: `mcp:${SESSION.sessionId}` },
  requester: { kind: 'mcp', sessionId: SESSION.sessionId, name: SESSION.name },
  holdMs: 30,
  ...extra,
});

async function opened(w: ReturnType<typeof world>): Promise<RunId> {
  return unwrap(await w.runner.open(SESSION)).runId;
}

describe('the external runner', () => {
  it('opens one external run in its own conversation, with no model loop', async () => {
    const w = world();
    const handle = unwrap(await w.runner.open(SESSION));
    const events = await w.events(handle.runId);
    expect(events.map((e) => e.type)).toEqual(['run.started', 'run.paused']);
    expect(ofType(events, 'run.started')[0]?.payload).toMatchObject({
      conversationId: handle.conversationId,
      autonomy: 'before-render',
      external: { sessionId: SESSION.sessionId, name: 'Claude Code', client: 'claude-code' },
    });
    expect(unwrap(await w.conversations.get(handle.conversationId)).runs).toEqual([{ runId: handle.runId }]);
    // The agent never drives it: resume and recovery leave it alone, and no model is asked.
    expect(unwrap(await w.agent.resume(handle.runId)).status).toBe('paused');
    expect(unwrap(await w.agent.recoverInterrupted())).toEqual([]);
    expect(w.models.requests).toHaveLength(0);
  });

  it('runs a read and a write, the write with the session as its origin; a repeat reads the log', async () => {
    const w = world();
    const runId = await opened(w);
    const read = unwrap(
      await w.runner.call(runId, 'clips.countWords', { text: 'a b c' }, opts('k1', { level: 'read' })),
    );
    expect(read.kind === 'done' && read.result.value).toEqual({ words: 3 });
    const write = unwrap(
      await w.runner.call(runId, 'clips.renameClip', { id: 'c1', title: 'Hook' }, opts('k2')),
    );
    expect(write.kind).toBe('done');
    expect(w.dispatched).toEqual([
      {
        command: 'clips.renameClip',
        meta: expect.objectContaining({ source: 'mcp', actor: `mcp:${SESSION.sessionId}`, runId }),
      },
    ]);
    const again = unwrap(
      await w.runner.call(runId, 'clips.renameClip', { id: 'c1', title: 'Hook' }, opts('k2')),
    );
    expect(again.kind === 'done' && again.result.deduplicated).toBe(true);
    expect(w.dispatched).toHaveLength(1);
    const requested = ofType(await w.events(runId), 'tool.requested').map((e) => e.payload.modelToolCallId);
    expect(requested).toEqual(['k1', 'k2']);
  });

  it("refuses a tool above the session's level", async () => {
    const w = world();
    const runId = await opened(w);
    const write = await w.runner.call(
      runId,
      'clips.renameClip',
      { id: 'c1', title: 'x' },
      opts('k', { level: 'read' }),
    );
    expect(!write.ok && write.error).toMatchObject({
      code: 'agent.external_level_too_low',
      params: { level: 'read' },
    });
    const render = await w.runner.call(runId, 'clips.renderVideo', { preset: 'reel' }, opts('r'));
    expect(!render.ok && render.error.code).toBe('agent.external_level_too_low');
    const unknown = await w.runner.call(runId, 'clips.nothing', {}, opts('n'));
    expect(!unknown.ok && unknown.error.code).toBe('tools.not_found');
  });

  it('holds a call for approval, answers pending with a card that names the session, and resumes it', async () => {
    const w = world();
    const runId = await opened(w);
    const ticks: (number | null)[] = [];
    const pending = unwrap(
      await w.runner.call(
        runId,
        'clips.deleteClip',
        { id: 'c9' },
        opts('del', { onProgress: (f) => ticks.push(f) }),
      ),
    );
    expect(pending.kind).toBe('pending');
    const approvalId = pending.kind === 'pending' ? pending.approvalId : '';
    const card = ofType(await w.events(runId), 'card.sent')[0]?.payload.card;
    expect(cardSchema.safeParse(card).success).toBe(true);
    expect(card).toMatchObject({
      type: 'approval',
      approvalId,
      tool: 'clips.deleteClip',
      sideEffect: 'destructive',
      status: 'pending',
      requester: { kind: 'mcp', sessionId: SESSION.sessionId, name: 'Claude Code' },
    });
    expect(ticks.length).toBeGreaterThan(0);
    expect(w.dispatched).toHaveLength(0);
    unwrap(await w.agent.answer(runId, { requestId: approvalId, decision: 'approve' }));
    const done = unwrap(await w.runner.call(runId, 'clips.deleteClip', { id: 'c9' }, opts('del')));
    expect(done.kind).toBe('done');
    expect(w.dispatched.map((d) => d.command)).toEqual(['clips.deleteClip']);
    // One call, under one id.
    expect(ofType(await w.events(runId), 'tool.requested')).toHaveLength(1);
  });

  it('goes on at once when the person answers during the hold, and says declined when they say no', async () => {
    const w = world();
    const runId = await opened(w);
    const answerSoon = (decision: 'approve' | 'deny') =>
      w.agent.subscribe((event) => {
        if ('seq' in event && event.type === 'approval.requested' && event.runId === runId)
          setTimeout(() => void w.agent.answer(runId, { requestId: event.payload.requestId, decision }), 5);
      });
    const stop = answerSoon('approve');
    const done = unwrap(
      await w.runner.call(runId, 'clips.deleteClip', { id: 'a' }, opts('a', { holdMs: 2_000 })),
    );
    stop();
    expect(done.kind).toBe('done');
    const stopDeny = answerSoon('deny');
    const declined = unwrap(
      await w.runner.call(runId, 'clips.deleteClip', { id: 'b' }, opts('b', { holdMs: 2_000 })),
    );
    stopDeny();
    expect(declined).toEqual({ kind: 'declined' });
    expect(unwrap(await w.runner.call(runId, 'clips.deleteClip', { id: 'b' }, opts('b')))).toEqual({
      kind: 'declined',
    });
  });

  it('revoking expires pending approvals and ends the run; closing again is a no-op', async () => {
    const w = world();
    const runId = await opened(w);
    const pending = unwrap(await w.runner.call(runId, 'clips.deleteClip', { id: 'c1' }, opts('d')));
    expect(pending.kind).toBe('pending');
    unwrap(await w.runner.close(runId, 'revoked'));
    const events = await w.events(runId);
    expect(ofType(events, 'approval.denied')[0]?.payload).toMatchObject({ note: 'revoked' });
    expect(ofType(events, 'card.sent').at(-1)?.payload.card).toMatchObject({
      type: 'approval',
      status: 'expired',
    });
    expect(events.at(-1)?.type).toBe('run.cancelled');
    unwrap(await w.runner.close(runId, 'revoked'));
    const after = await w.runner.call(runId, 'clips.countWords', { text: 'x' }, opts('late'));
    expect(!after.ok && after.error.code).toBe('agent.run_finished');
  });

  it("the chat's stop ends the session's run", async () => {
    const w = world();
    const runId = await opened(w);
    unwrap(await w.runner.call(runId, 'clips.countWords', { text: 'x' }, opts('x')));
    const stopped = unwrap(await w.agent.cancel(runId));
    expect(stopped.status).toBe('cancelled');
  });

  it('after a restart, a repeat finds the run and its call in the log', async () => {
    const store = createMemoryEventLogStore();
    const before = world({ store });
    const runId = await opened(before);
    const pending = unwrap(await before.runner.call(runId, 'clips.deleteClip', { id: 'z' }, opts('z')));
    const approvalId = pending.kind === 'pending' ? pending.approvalId : '';
    const after = world({ store });
    unwrap(await after.agent.answer(runId, { requestId: approvalId, decision: 'approve' }));
    const done = unwrap(await after.runner.call(runId, 'clips.deleteClip', { id: 'z' }, opts('z')));
    expect(done.kind).toBe('done');
    expect(after.dispatched.map((d) => d.meta.source)).toEqual(['mcp']);
    const notExternal = unwrap(await after.agent.run({ conversationId: 'c', message: 'hi' }));
    const refused = await after.runner.call(notExternal.runId, 'clips.countWords', { text: 'x' }, opts('q'));
    expect(!refused.ok && refused.error.code).toBe('agent.run_not_found');
  });

  it('refuses internet tools while Local only is on now', async () => {
    let localOnly = false;
    const w = world({ localOnly: () => localOnly });
    const runId = await opened(w);
    localOnly = true;
    const shared = await w.runner.call(
      runId,
      'clips.shareClip',
      { id: 'c1' },
      opts('s', { level: 'export' }),
    );
    expect(!shared.ok && shared.error.code).toBe('tools.permission_denied');
  });
});

describe("the agent's command dispatcher", () => {
  it('audits an external agent by its session, and the built-in agent by its run', async () => {
    const store = createMemoryAuditLogStore();
    const bus = createCommandBus({ store, clock: { now: () => 1 } });
    bus.register(
      defineCommand({
        name: 'clips.rename',
        payload: z.object({ id: z.string() }),
        sideEffect: 'write',
        handle: () => ok({ result: null }),
      }),
    );
    const dispatcher = createCommandDispatcher(bus);
    const base = { toolCallId: newId<'ToolRun'>(), tool: 'clips.rename' };
    const runId = newId<'AgentRun'>();
    unwrap(
      await dispatcher.dispatch('clips.rename', { id: 'a' }, { ...base, source: 'mcp', actor: 'mcp:s1' }),
    );
    unwrap(await dispatcher.dispatch('clips.rename', { id: 'b' }, { ...base, source: 'agent', runId }));
    expect(store.entries().map((e) => [e.source, e.actor])).toEqual([
      ['mcp', 'mcp:s1'],
      ['agent', `agent:${runId}`],
    ]);
  });
});
