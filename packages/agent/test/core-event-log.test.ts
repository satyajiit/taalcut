// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The agent on core's EventLogStore (what library persists), through
 * fromCoreEventLog: runs, pauses and resumes in another agent; the store
 * sees the run's status and conversation. Plus the scripted client's call log.
 */
import {
  createMemoryEventLogStore as createCoreEventLogStore,
  newId,
  ok,
  unwrap,
  type CloudCallRecord,
} from '@taalcut/core';
import { createScriptedModelClient, fromCoreEventLog, newEvent } from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { call, harness, plan, turns } from './support/harness';

const script = turns(
  plan('Delete the blurry clip'),
  { toolCalls: [call('clips_deleteClip', { id: 'c1' })] },
  { text: 'Done.' },
);

describe('fromCoreEventLog', () => {
  it('runs, pauses and resumes in another agent, keeping the run status in core’s store', async () => {
    const core = createCoreEventLogStore();
    const store = fromCoreEventLog(core);
    const conversationId = newId<'Conversation'>();
    const first = harness({ script, store });
    const paused = unwrap(await first.agent.run({ conversationId, message: 'delete c1' }));
    expect(paused.status).toBe('paused');
    expect(unwrap(await core.listRuns())).toMatchObject([
      { runId: paused.runId, conversationId, status: 'paused' },
    ]);
    expect(unwrap(await store.openRuns())).toEqual([paused.runId]);
    // Core numbers entries from 1; the agent sees its own events from 0.
    expect(unwrap(await core.read(paused.runId))[0]).toMatchObject({
      seq: 1,
      type: 'run.started',
      data: { v: 1 },
    });
    expect(
      unwrap(await store.read(paused.runId))
        .map((e) => e.seq)
        .slice(0, 3),
    ).toEqual([0, 1, 2]);

    const second = harness({ script, store });
    const requestId = paused.pending[0]!.requestId;
    const done = unwrap(await second.agent.answer(paused.runId, { requestId, decision: 'approve' }));
    expect(done.status).toBe('completed');
    expect(unwrap(await core.listRuns())[0]?.status).toBe('succeeded');
    expect(unwrap(await store.openRuns())).toEqual([]);
    expect(unwrap(await store.read(paused.runId, 5))[0]?.seq).toBe(5);
  });

  it('reads an unknown run as empty and reports a stale writer as agent.log_conflict', async () => {
    const store = fromCoreEventLog(createCoreEventLogStore());
    const runId = newId<'AgentRun'>();
    expect(unwrap(await store.read(runId))).toEqual([]);
    const started = newEvent(
      'run.started',
      {
        conversationId: 'not-a-ulid',
        message: 'hi',
        autonomy: 'autopilot',
        budget: {},
        localOnly: false,
        soulVersion: '1',
        catalogueHash: 'x',
      },
      1,
    );
    expect(unwrap(await store.append(runId, 0, [started]))).toBe(0);
    const stale = await store.append(runId, 0, [started]);
    expect(!stale.ok && stale.error.code).toBe('agent.log_conflict');
  });
});

describe('the scripted model client', () => {
  it('logs one CloudCall per call, like the real client', async () => {
    const calls: CloudCallRecord[] = [];
    const client = createScriptedModelClient(() => ({ text: 'Hi.', provider: 'google', model: 'g' }), {
      callLog: { record: async (r) => (calls.push(r), ok(undefined)) },
      now: () => 42,
    });
    unwrap(await client.complete({ module: 'agent', messages: [], trace: { runId: 'r1', spanId: 's1' } }));
    const failing = createScriptedModelClient(
      () => ({ error: { code: 'models.down', messageKey: 'x', retryable: true } }),
      {
        callLog: { record: async (r) => (calls.push(r), ok(undefined)) },
      },
    );
    expect((await failing.complete({ module: 'vision', messages: [] })).ok).toBe(false);
    expect(calls).toMatchObject([
      {
        module: 'agent',
        provider: 'google',
        local: false,
        startedAt: 42,
        outcome: 'ok',
        runId: 'r1',
        spanId: 's1',
      },
      { module: 'vision', provider: 'scripted', local: true, outcome: 'error', errorCode: 'models.down' },
    ]);
  });
});
