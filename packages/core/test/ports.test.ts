// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Persistence ports that library implements: the run log, cloud-call records and job records. */
import { describe, expect, it } from 'vitest';
import {
  cloudCallRecordSchema,
  createMemoryEventLogStore,
  jobRecordSchema,
  newId,
  runLogEntrySchema,
  runSummarySchema,
  unwrap,
  type CloudCallRecord,
} from '@taalcut/core';

describe('EventLogStore (in-memory reference)', () => {
  it('appends with an optimistic sequence check and reads from a sequence', async () => {
    const store = createMemoryEventLogStore();
    const runId = newId<'AgentRun'>();
    const conversationId = newId<'Conversation'>();
    const first = await store.append(
      runId,
      [
        { at: 10, type: 'run.started', data: { goal: 'probe' } },
        { at: 11, type: 'tool.called', data: { tool: 'media.probe' } },
      ],
      { expectedSeq: 0, conversationId },
    );
    expect(unwrap(first)).toEqual({ lastSeq: 2 });

    const stale = await store.append(runId, [{ at: 12, type: 'x', data: null }], { expectedSeq: 1 });
    expect(!stale.ok && stale.error).toMatchObject({
      code: 'core.conflict',
      params: { entity: 'run', id: runId },
    });

    unwrap(
      await store.append(runId, [{ at: 13, type: 'approval.asked', data: {} }], {
        expectedSeq: 2,
        status: 'paused',
      }),
    );
    const tail = unwrap(await store.read(runId, 2));
    expect(tail.map((entry) => [entry.seq, entry.type])).toEqual([
      [2, 'tool.called'],
      [3, 'approval.asked'],
    ]);
    expect(unwrap(await store.read(runId)).every((entry) => runLogEntrySchema.safeParse(entry).success)).toBe(
      true,
    );
    const missing = await store.read(newId<'AgentRun'>());
    expect(!missing.ok && missing.error.code).toBe('core.not_found');
  });

  it('lists runs to resume, newest first, by status and conversation', async () => {
    const store = createMemoryEventLogStore();
    const conversationId = newId<'Conversation'>();
    const [a, b, c] = [newId<'AgentRun'>(), newId<'AgentRun'>(), newId<'AgentRun'>()];
    unwrap(
      await store.append(a, [{ at: 1, type: 'run.started', data: null }], { expectedSeq: 0, conversationId }),
    );
    unwrap(
      await store.append(b, [{ at: 2, type: 'run.started', data: null }], {
        expectedSeq: 0,
        status: 'paused',
      }),
    );
    unwrap(
      await store.append(c, [{ at: 3, type: 'run.finished', data: null }], {
        expectedSeq: 0,
        status: 'succeeded',
      }),
    );
    unwrap(await store.append(a, [], { expectedSeq: 1 }));

    const unfinished = unwrap(await store.listRuns({ statuses: ['running', 'paused'] }));
    expect(unfinished.map((run) => run.runId)).toEqual([b, a]);
    expect(unwrap(await store.listRuns({ conversationId }))).toMatchObject([
      { runId: a, status: 'running', lastSeq: 1, startedAt: 1, conversationId },
    ]);
    expect(unwrap(await store.listRuns({ limit: 1 }))).toHaveLength(1);
    for (const run of unwrap(await store.listRuns())) expect(runSummarySchema.parse(run)).toEqual(run);
  });
});

describe('record schemas', () => {
  it('validates cloud-call records as models produces them', () => {
    const record: CloudCallRecord = {
      id: newId<'CloudCall'>(),
      module: 'vision',
      provider: 'openai',
      model: 'gpt-6-mini',
      reasoning: 'low',
      local: false,
      startedAt: 1_000,
      latencyMs: 812,
      bytesSent: 182_000,
      bytesReceived: 2_400,
      inputTokens: 1_500,
      outputTokens: 120,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.0021,
      outcome: 'ok',
      attempt: 1,
    };
    expect(cloudCallRecordSchema.parse(record)).toEqual(record);
    expect(cloudCallRecordSchema.safeParse({ ...record, module: 'telepathy' }).success).toBe(false);
    expect(cloudCallRecordSchema.safeParse({ ...record, inputTokens: -1 }).success).toBe(false);
  });

  it('validates stored jobs with their input', () => {
    const job = {
      id: newId<'Job'>(),
      kind: 'media.probe',
      state: 'queued' as const,
      priority: 'normal' as const,
      resource: 'io' as const,
      projectId: null,
      idempotencyKey: null,
      parentId: null,
      attempt: 1,
      maxAttempts: 3,
      progress: null,
      error: null,
      createdAt: 1,
      updatedAt: 1,
      startedAt: null,
      finishedAt: null,
      nextAttemptAt: null,
      input: { path: '/Volumes/Trip/a.mov' },
    };
    expect(jobRecordSchema.parse(job)).toEqual(job);
    expect(jobRecordSchema.safeParse({ ...job, state: 'lost' }).success).toBe(false);
  });
});
