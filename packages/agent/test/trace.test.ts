// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P1-G5 "Done when" (backend): the gate demo produces a complete trace with
 * no missing spans: tokens, cost, latency and cache hits on every model and
 * tool span, rebuilt from the log alone.
 */
import { unwrap, type RunId } from '@taalcut/core';
import {
  buildTrace,
  checkTrace,
  createMemoryTraceExporter,
  toOtelSpans,
  type AgentEvent,
} from '@taalcut/agent';
import { describe, expect, it } from 'vitest';
import { gateDemoModules } from './support/fixtures';
import { call, harness, plan, turns } from './support/harness';

const usage = { inputTokens: 900, outputTokens: 60, costUsd: 0.001 };
const gateDemo = turns(
  { ...plan('Add the Trip folder', 'Probe the first video', 'Describe a frame'), usage },
  { toolCalls: [call('library_addSource', { path: '~/Desktop/Trip' })], usage },
  { text: 'Added the Trip folder.', usage },
  { toolCalls: [call('media_probe', { path: '~/Desktop/Trip/a.mov' })], usage },
  { text: 'It is 12.5 s, vertical.', usage },
  { toolCalls: [call('vision_describeFrame', { path: '~/Desktop/Trip/a.mov', atSeconds: 1 })], usage },
  { text: 'The first video opens on a drone shot over a beach at sunrise.', usage },
);
const ASK = {
  conversationId: 'gate',
  message: 'Add my Desktop/Trip folder and tell me what is in the first video.',
};

describe('the gate demo trace', () => {
  it('is complete: every span ended, with tokens, cost, latency and cache flags', async () => {
    const exporter = createMemoryTraceExporter();
    const h = harness({
      modules: gateDemoModules(),
      script: gateDemo,
      settings: { autonomy: 'before-render' },
      deps: { traceExporter: exporter },
    });
    const outcome = unwrap(await h.agent.run(ASK));
    expect(outcome.status).toBe('completed');
    const trace = unwrap(await h.agent.trace(outcome.runId));

    expect(checkTrace(trace)).toEqual([]);
    const count = (kind: string) => trace.spans.filter((s) => s.kind === kind).length;
    expect([count('run'), count('step'), count('model'), count('tool')]).toEqual([1, 3, 7, 4]);
    const tools = trace.spans.filter((s) => s.kind === 'tool' && !s.attributes.meta);
    expect(tools.map((s) => s.name)).toEqual(['library.addSource', 'media.probe', 'vision.describeFrame']);
    expect(tools.find((s) => s.name === 'vision.describeFrame')?.attributes).toMatchObject({
      costUsd: 0.004,
      inputTokens: 1200,
      outputTokens: 30,
      cached: false,
    });
    expect(trace.spans.find((s) => s.kind === 'model')?.attributes).toMatchObject({
      provider: 'scripted',
      inputTokens: 900,
      outputTokens: 60,
      costUsd: 0.001,
      latencyMs: 5,
    });
    expect(trace.totals).toMatchObject({ modelCalls: 7, toolCalls: 3, cacheHits: 0 });
    expect(trace.totals.usd).toBeCloseTo(7 * 0.001 + 0.004, 10);
    // Steps nest under the run, calls under their step.
    const step2 = trace.spans.filter((s) => s.kind === 'step')[1]!;
    expect(trace.spans.find((s) => s.name === 'media.probe')?.parentSpanId).toBe(step2.spanId);
    // The exporter got the same trace when the run ended, and it survives JSON.
    expect(exporter.traces).toEqual([trace]);
    expect(JSON.parse(JSON.stringify(trace))).toEqual(trace);
  });

  it('shows cache hits on a second run', async () => {
    const h = harness({ modules: gateDemoModules(), script: gateDemo });
    unwrap(await h.agent.run(ASK));
    const second = unwrap(await h.agent.run(ASK));
    const trace = unwrap(await h.agent.trace(second.runId));
    expect(trace.spans.find((s) => s.name === 'media.probe')?.attributes.cached).toBe(true);
    expect(trace.totals.cacheHits).toBe(1);
    expect(checkTrace(trace)).toEqual([]);
  });

  it('maps to OpenTelemetry GenAI attributes without prompt or output text', async () => {
    const h = harness({ modules: gateDemoModules(), script: gateDemo });
    const outcome = unwrap(await h.agent.run(ASK));
    const spans = toOtelSpans(unwrap(await h.agent.trace(outcome.runId)));
    expect(new Set(spans.map((s) => s.traceId)).size).toBe(1);
    expect(spans[0]!.traceId).toMatch(/^[0-9a-f]{32}$/);
    const model = spans.find((s) => s.kind === 'CLIENT')!;
    expect(model.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.request.model': 'script-1',
      'gen_ai.usage.input_tokens': 900,
      'gen_ai.provider.name': 'scripted',
    });
    const tool = spans.find((s) => s.attributes['gen_ai.tool.name'] === 'vision.describeFrame')!;
    expect(tool.attributes['taalcut.costUsd']).toBe(0.004);
    const ids = new Set(spans.map((s) => s.spanId));
    expect(spans.every((s) => !s.parentSpanId || ids.has(s.parentSpanId))).toBe(true);
    expect(JSON.stringify(spans)).not.toContain('drone shot');
  });
});

describe('trace checks', () => {
  it('shows approval waits and keeps open spans legal while paused', async () => {
    const h = harness({
      script: turns(
        plan('Delete'),
        { toolCalls: [call('clips_deleteClip', { id: 'c1' })] },
        { text: 'Done.' },
      ),
    });
    const paused = unwrap(await h.agent.run({ conversationId: 'c', message: 'delete' }));
    let trace = unwrap(await h.agent.trace(paused.runId));
    expect(trace.status).toBe('paused');
    expect(checkTrace(trace)).toEqual([]);
    unwrap(
      await h.agent.answer(paused.runId, { requestId: paused.pending[0]!.requestId, decision: 'approve' }),
    );
    trace = unwrap(await h.agent.trace(paused.runId));
    const approval = trace.spans.find((s) => s.kind === 'approval');
    expect(approval).toMatchObject({ status: 'ok', attributes: { kind: 'tool', decision: 'granted' } });
    expect(checkTrace(trace)).toEqual([]);
  });

  it('flags spans that never ended in a finished run, and spans missing numbers', () => {
    const runId = '01J00000000000000000000000' as RunId;
    const at = 1;
    const events = [
      {
        runId,
        seq: 0,
        v: 1,
        at,
        type: 'run.started',
        payload: {
          conversationId: 'c',
          message: 'm',
          autonomy: 'autopilot',
          budget: {},
          localOnly: false,
          soulVersion: '0',
          catalogueHash: 'h',
        },
      },
      {
        runId,
        seq: 1,
        v: 1,
        at,
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
        runId,
        seq: 2,
        v: 1,
        at,
        type: 'model.requested',
        payload: {
          modelCallId: 'm2',
          phase: 'act',
          promptHash: 'p',
          toolNames: [],
          estimate: { tokens: 0, usd: 0 },
        },
      },
      { runId, seq: 3, v: 1, at, type: 'run.completed', payload: { report: '', did: [] } },
    ] as unknown as AgentEvent[];
    expect(checkTrace(buildTrace(runId, events))).toEqual([
      'tool span clips.countWords (t1) never ended',
      'model span model.act (m2) never ended',
    ]);
    const span = buildTrace(runId, events).spans[1]!;
    span.status = 'ok';
    expect(checkTrace({ ...buildTrace(runId, events), status: 'paused', spans: [span] })[0]).toBe(
      'tool span clips.countWords (t1) has no latencyMs',
    );
  });
});
