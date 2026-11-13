// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-G5: runs and spans go to the trace viewer's store as they happen. The
 * store here behaves like library's (upserts, the first header sets the
 * start); the gate demo checks the real one.
 */
import { newId, ok, unwrap, type RunId } from '@taalcut/core';
import {
  createAgent,
  createMemoryEventLogStore,
  createScriptedModelClient,
  createTraceRecorder,
  type AgentEvent,
  type TraceRunRecord,
  type TraceSpanRecord,
  type TraceStore,
} from '@taalcut/agent';
import { describe, expect, it, vi } from 'vitest';
import { call, harness, plan, registryFor, SOUL, turns } from './support/harness';
import { clipsModule } from './support/fixtures';

function memoryTraceStore() {
  const calls: (['run', TraceRunRecord] | ['span', TraceSpanRecord])[] = [];
  const runs = new Map<RunId, TraceRunRecord>();
  const spans = new Map<string, TraceSpanRecord>();
  const store: TraceStore = {
    async recordRun(run) {
      calls.push(['run', run]);
      runs.set(run.runId, { ...run, startedAt: runs.get(run.runId)?.startedAt ?? run.startedAt });
      return ok(undefined);
    },
    async recordSpan(runId, span) {
      calls.push(['span', span]);
      spans.set(`${runId}/${span.spanId}`, span);
      return ok(undefined);
    },
  };
  const headers = () => calls.flatMap(([kind, record]) => (kind === 'run' ? [record as TraceRunRecord] : []));
  const spanCalls = () =>
    calls.flatMap(([kind, record]) => (kind === 'span' ? [record as TraceSpanRecord] : []));
  return { store, calls, runs, spans, headers, spanCalls };
}

const usage = { inputTokens: 900, outputTokens: 60, costUsd: 0.001 };
const share = turns(
  { ...plan('Share the clip'), usage },
  { toolCalls: [call('clips_shareClip', { id: 'c1' })], text: 'Sharing it now.', usage },
  { text: 'Shared.', usage },
);
const ASK = { conversationId: newId<'Conversation'>(), message: 'Share clip c1' };

describe('traces in the store', () => {
  it('records the header on every status change and each span as it opens and closes', async () => {
    const traces = memoryTraceStore();
    const h = harness({
      script: share,
      settings: { autonomy: 'before-render' },
      deps: { traces: traces.store },
    });
    const paused = unwrap(await h.agent.run(ASK));
    expect(paused.status).toBe('paused');
    const done = unwrap(
      await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
    );
    expect(done.status).toBe('completed');

    const headers = traces.headers();
    expect(headers.map((r) => r.status)).toEqual(['running', 'paused', 'running', 'succeeded']);
    expect(headers[0]).toEqual({
      runId: paused.runId,
      conversationId: ASK.conversationId,
      message: ASK.message,
      startedAt: expect.any(Number),
      status: 'running',
    });
    expect(headers.at(-1)).toMatchObject({ endedAt: expect.any(Number), gaps: [] });

    // Each span: first open ('running', no end), last closed.
    const byId = Map.groupBy(traces.spanCalls(), (s) => s.spanId);
    const trace = unwrap(await h.agent.trace(paused.runId));
    expect([...byId.keys()].sort()).toEqual(trace.spans.map((s) => s.spanId).sort());
    for (const [spanId, records] of byId) {
      expect(records[0], spanId).toMatchObject({ status: 'running' });
      expect(records[0]?.endedAt, spanId).toBeUndefined();
      expect(records.at(-1), spanId).toMatchObject({ status: 'ok', endedAt: expect.any(Number) });
    }

    const stored = [...traces.spans.values()];
    expect(stored.find((s) => s.kind === 'run')).toMatchObject({ name: ASK.message, parentSpanId: null });
    expect(stored.find((s) => s.kind === 'model')).toMatchObject({
      name: 'scripted/script-1',
      provider: 'scripted',
      model: 'script-1',
      inputTokens: 900,
      outputTokens: 60,
      costUsd: 0.001,
      stopReason: 'tool_calls',
      events: [],
    });
    expect(stored.find((s) => s.kind === 'tool' && s.name === 'clips.shareClip')).toMatchObject({
      tool: 'clips.shareClip',
      sideEffect: 'external',
      attempts: 1,
      cacheHit: false,
      deduplicated: false,
      version: '1.0.0',
      parentSpanId: expect.stringMatching(/^step:/),
    });
    const approval = stored.find((s) => s.kind === 'approval');
    expect(approval).toMatchObject({
      status: 'ok',
      parentSpanId: stored.find((s) => s.name === 'clips.shareClip')?.spanId,
    });
    expect(approval?.name).not.toBe('approval.tool');
  });

  it('catches up on a run reopened by another agent (after a restart), and keeps run ids that are not ULIDs out', async () => {
    const traces = memoryTraceStore();
    const log = createMemoryEventLogStore();
    const agentWith = () =>
      createAgent({
        models: createScriptedModelClient(share),
        tools: registryFor([clipsModule()]),
        log,
        soul: SOUL,
        settings: { autonomy: 'before-render', budget: {} },
        traces: traces.store,
      });
    const first = agentWith();
    const paused = unwrap(await first.run({ conversationId: 'not-a-ulid', message: 'share' }));
    traces.calls.length = 0;

    const second = agentWith();
    unwrap(
      await second.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
    );
    // The first write from the new agent is the header, then every span so far.
    expect(traces.calls[0]).toEqual([
      'run',
      expect.objectContaining({ status: 'paused', conversationId: null }),
    ]);
    expect(traces.runs.get(paused.runId)).toMatchObject({ status: 'succeeded', gaps: [] });
    expect([...traces.spans.values()].every((s) => s.status === 'ok')).toBe(true);
  });

  it('records gaps when a run ends with spans open, and a stopped run as cancelled', async () => {
    const traces = memoryTraceStore();
    const recorder = createTraceRecorder(traces.store);
    const runId = newId<'AgentRun'>();
    const at = 1_000;
    const events = [
      {
        type: 'run.started',
        payload: {
          conversationId: 'c',
          message: 'go',
          autonomy: 'autopilot',
          budget: {},
          localOnly: false,
          soulVersion: '1',
          catalogueHash: 'h',
        },
      },
      {
        type: 'tool.requested',
        payload: {
          toolCallId: 't1',
          modelCallId: 'm1',
          modelToolCallId: 'x',
          tool: 'clips.countWords',
          callName: 'clips_countWords',
          meta: false,
          input: {},
          sideEffect: 'read',
        },
      },
      {
        type: 'model.requested',
        payload: {
          modelCallId: 'm2',
          phase: 'act',
          promptHash: 'p',
          toolNames: [],
          estimate: { tokens: 0, usd: 0 },
        },
      },
      { type: 'run.cancelled', payload: {} },
    ].map((e, seq) => ({ ...e, runId, seq, v: 1, at: at + seq })) as unknown as AgentEvent[];
    events.forEach((event, i) => recorder.record(event, events.slice(0, i + 1)));
    await recorder.flush(runId);

    expect(traces.runs.get(runId)).toMatchObject({
      status: 'cancelled',
      endedAt: 1_003,
      gaps: [
        { spanId: 't1', seq: 2, reason: 'no-outcome' },
        { spanId: 'm2', seq: 3, reason: 'no-outcome' },
      ],
    });
    expect(traces.spans.get(`${runId}/${runId}`)).toMatchObject({ status: 'cancelled', endedAt: 1_003 });
    expect(traces.spans.get(`${runId}/t1`)).toMatchObject({ status: 'running' });
  });

  it('never lets a failing store hold up or fail a run', async () => {
    const failing: TraceStore = {
      recordRun: async () => {
        throw new Error('disk full');
      },
      recordSpan: async () => ({
        ok: false,
        error: { code: 'core.io', messageKey: 'errors.core.io', retryable: false },
      }),
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const h = harness({ script: turns(plan('Count'), { text: 'Done.' }), deps: { traces: failing } });
    expect(unwrap(await h.agent.run({ conversationId: 'c', message: 'count' })).status).toBe('completed');
    const reported = warn.mock.calls.map(([line]) => String(line));
    warn.mockRestore();
    expect(reported.length).toBeGreaterThan(0);
    expect(
      reported.every(
        (line) => line.startsWith('[agent] a trace write for run ') && line.endsWith('disk full'),
      ),
    ).toBe(true);
  });
});
