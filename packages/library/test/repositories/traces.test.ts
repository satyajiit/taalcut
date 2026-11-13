// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The TraceStore the agent writes and the developer trace viewer reads (P1-G5). */
import { join } from 'node:path';
import { newId, NotFoundError, unwrap, ValidationError, type RunId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createLibraryPorts,
  createRepositories,
  createTraceStore,
  openDatabase,
  scanForSecrets,
  type TraceSpan,
} from '../../src/index';
import { cloudCall } from '../fixtures/records';
import { fakeClock, openTestDb, tempDir } from '../helpers';

const RUN = newId<'AgentRun'>();

function span(overrides: Partial<TraceSpan> & Pick<TraceSpan, 'spanId' | 'kind'>): TraceSpan {
  return { parentSpanId: RUN, name: overrides.kind, startedAt: 100, status: 'ok', events: [], ...overrides };
}

/** A run: step → model call, step → tool call (cache hit) → approval; recorded as the agent would. */
async function recordRun(store: ReturnType<typeof createTraceStore>, runId: RunId = RUN, startedAt = 100) {
  unwrap(
    await store.recordRun({
      runId,
      conversationId: null,
      status: 'running',
      message: 'Make a reel',
      startedAt,
    }),
  );
  const spans: TraceSpan[] = [
    span({
      spanId: runId,
      parentSpanId: null,
      kind: 'run',
      name: 'Make a reel',
      startedAt,
      status: 'running',
    }),
    span({
      spanId: 'step-2',
      kind: 'step',
      name: 'Pick shots',
      startedAt: startedAt + 50,
      endedAt: startedAt + 90,
    }),
    span({
      spanId: 'step-1',
      kind: 'step',
      name: 'Find footage',
      startedAt: startedAt + 1,
      endedAt: startedAt + 40,
    }),
    span({
      spanId: 'model-1',
      parentSpanId: 'step-1',
      kind: 'model',
      name: 'openai/gpt-5',
      startedAt: startedAt + 2,
      endedAt: startedAt + 20,
      provider: 'openai',
      model: 'gpt-5',
      stopReason: 'tool_calls',
      inputTokens: 1000,
      cachedInputTokens: 200,
      outputTokens: 50,
      costUsd: 0.01,
      events: [{ name: 'retry', at: startedAt + 5, detail: '429' }],
    }),
    span({
      spanId: 'tool-1',
      parentSpanId: 'step-1',
      kind: 'tool',
      name: 'media.probe',
      startedAt: startedAt + 21,
      endedAt: startedAt + 30,
      tool: 'media.probe',
      version: '1',
      sideEffect: 'read',
      attempts: 1,
      cacheHit: true,
      costUsd: 0,
    }),
    span({
      spanId: 'approval-1',
      parentSpanId: 'tool-1',
      kind: 'approval',
      name: 'Reads files',
      startedAt: startedAt + 22,
    }),
  ];
  for (const s of spans) unwrap(await store.recordSpan(runId, s));
  return spans;
}

describe('TraceStore', () => {
  it('returns a run’s spans depth-first, parents before children, siblings by start', async () => {
    const store = createLibraryPorts(openTestDb({ file: false })).traces;
    const spans = await recordRun(store);
    // The run span closes later: recording it again replaces it.
    unwrap(await store.recordSpan(RUN, { ...spans[0]!, status: 'ok', endedAt: 200 }));
    unwrap(
      await store.recordRun({
        runId: RUN,
        conversationId: null,
        status: 'succeeded',
        message: 'Make a reel',
        startedAt: 100,
        endedAt: 200,
      }),
    );
    const trace = unwrap(await store.get({ runId: RUN }));
    expect(trace.spans.map((s) => s.spanId)).toEqual([
      RUN,
      'step-1',
      'model-1',
      'tool-1',
      'approval-1',
      'step-2',
    ]);
    expect(trace).toMatchObject({ status: 'succeeded', startedAt: 100, endedAt: 200, gaps: [] });
    expect(trace.spans[2]).toEqual(spans[3]);
    expect(trace.spans[3]).toEqual(spans[4]);
    expect(trace.spans[0]).toMatchObject({ status: 'ok', endedAt: 200 });
    expect('endedAt' in trace.spans[4]!).toBe(false);
  });

  it('lists runs newest first with totals and completeness', async () => {
    const store = createTraceStore(openTestDb({ file: false }));
    await recordRun(store);
    const second = newId<'AgentRun'>();
    unwrap(
      await store.recordRun({
        runId: second,
        conversationId: null,
        status: 'failed',
        message: 'Second',
        startedAt: 500,
        endedAt: 600,
        gaps: [{ spanId: 'm', seq: 4, reason: 'no-cost' }],
      }),
    );
    expect(unwrap(await store.runs())).toEqual([
      {
        runId: second,
        conversationId: null,
        status: 'failed',
        message: 'Second',
        startedAt: 500,
        endedAt: 600,
        modelCalls: 0,
        toolCalls: 0,
        tokens: 0,
        costUsd: 0,
        cacheHits: 0,
        complete: false,
      },
      {
        runId: RUN,
        conversationId: null,
        status: 'running',
        message: 'Make a reel',
        startedAt: 100,
        modelCalls: 1,
        toolCalls: 1,
        tokens: 1250,
        costUsd: 0.01,
        cacheHits: 1,
        complete: true,
      },
    ]);
    expect(unwrap(await store.runs({ limit: 1 }))).toHaveLength(1);
  });

  it('keeps only the newest runs, with their spans', async () => {
    const db = openTestDb({ file: false });
    const store = createTraceStore(db, { maxRuns: 3 });
    const ids = Array.from({ length: 5 }, () => newId<'AgentRun'>());
    for (const [i, runId] of ids.entries()) await recordRun(store, runId, 1000 * (i + 1));
    expect(unwrap(await store.runs()).map((r) => r.runId)).toEqual([ids[4], ids[3], ids[2]]);
    const expired = await store.get({ runId: ids[0]! });
    expect(!expired.ok && NotFoundError.is(expired.error)).toBe(true);
    expect(db.driver.prepare('SELECT count(*) AS n FROM trace_spans').get()?.n).toBe(18);
  });

  it('creates a run for a span that comes first, and validates input', async () => {
    const store = createTraceStore(openTestDb({ file: false }));
    unwrap(
      await store.recordSpan(
        RUN,
        span({ spanId: 'orphan', parentSpanId: 'gone', kind: 'tool', startedAt: 7 }),
      ),
    );
    const trace = unwrap(await store.get({ runId: RUN }));
    expect(trace).toMatchObject({
      status: 'running',
      message: '',
      startedAt: 7,
      spans: [{ spanId: 'orphan' }],
    });
    for (const bad of [{ kind: 'nope' }, { startedAt: -1 }, { inputTokens: 1.5 }, { spanId: '' }]) {
      const result = await store.recordSpan(RUN, span({ spanId: 's', kind: 'model', ...bad } as never));
      expect(!result.ok && ValidationError.is(result.error)).toBe(true);
    }
    const badRun = await store.recordRun({
      runId: 'not-a-ulid' as RunId,
      conversationId: null,
      status: 'running',
      message: '',
      startedAt: 0,
    });
    expect(badRun.ok).toBe(false);
  });

  it('stores no secrets from messages, span names or attributes', async () => {
    const path = join(tempDir(), 'library.db');
    const clock = fakeClock();
    const db = unwrap(openDatabase({ path, clock: clock.now }));
    const { traces, cloudCalls } = createLibraryPorts(db);
    const key = `sk-ant-api03-${'Kk7_'.repeat(8)}`;
    const jwt = `eyJ${'a'.repeat(12)}.eyJ${'b'.repeat(12)}.${'c'.repeat(12)}`;
    unwrap(
      await traces.recordRun({
        runId: RUN,
        conversationId: null,
        status: 'running',
        message: `use ${key}`,
        startedAt: 1,
      }),
    );
    unwrap(
      await traces.recordSpan(
        RUN,
        span({
          spanId: 'tool-1',
          kind: 'tool',
          name: `fetch with Bearer ${'t0k3n'.repeat(5)}`,
          errorCode: `auth failed for ${jwt}`,
          events: [{ name: 'retry', at: 2, detail: `refresh_token=${'r'.repeat(20)}` }],
        }),
      ),
    );
    for (let i = 0; i < 50; i++)
      unwrap(await cloudCalls.record(cloudCall({ errorCode: i % 2 ? `Bearer ${key}` : undefined })));
    const repos = createRepositories(db);
    expect(unwrap(repos.usage.list({ limit: 5 })).totals.calls).toBe(50);
    const report = scanForSecrets({ databasePath: path });
    expect(report.findings).toEqual([]);
    expect(report.scanned.values).toBeGreaterThan(100);
    expect(unwrap(await traces.get({ runId: RUN })).spans[0]).toMatchObject({
      errorCode: 'auth failed for [redacted:jwt]',
    });
    db.close();
  });
});
