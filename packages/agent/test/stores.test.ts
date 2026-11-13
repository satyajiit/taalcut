// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The event log stores, the envelope reader with upcasters, and the cost estimator. */
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newId, unwrap, type RunId } from '@taalcut/core';
import {
  createDefaultCostEstimator,
  createFileEventLogStore,
  createMemoryEventLogStore,
  newEvent,
  readEvent,
  type EventLogStore,
} from '@taalcut/agent';
import { afterEach, describe, expect, it } from 'vitest';

const started = (at = 1) =>
  newEvent(
    'run.started',
    {
      conversationId: 'c',
      message: 'm',
      autonomy: 'autopilot',
      budget: {},
      localOnly: false,
      soulVersion: '0',
      catalogueHash: 'h',
    },
    at,
  );
const done = newEvent('run.completed', { report: 'ok', did: [] }, 2);

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-log-'));
  dirs.push(dir);
  return dir;
}

describe.each([
  ['memory', () => createMemoryEventLogStore()],
  ['file', () => createFileEventLogStore(tempDir())],
] as const)('%s event log store', (_name, make: () => EventLogStore) => {
  it('numbers events from the expected seq and refuses a stale writer', async () => {
    const store = make();
    const runId = newId<'AgentRun'>();
    expect(unwrap(await store.append(runId, 0, [started()]))).toBe(0);
    const stale = await store.append(runId, 0, [started()]);
    expect(!stale.ok && stale.error).toMatchObject({
      code: 'agent.log_conflict',
      retryable: true,
      params: { runId, expectedSeq: 0 },
    });
    expect(
      unwrap(
        await store.append(runId, 1, [newEvent('run.paused', { reason: 'approval', requestIds: [] }, 2)]),
      ),
    ).toBe(1);
    expect(unwrap(await store.read(runId)).map((e) => [e.seq, e.type, e.runId])).toEqual([
      [0, 'run.started', runId],
      [1, 'run.paused', runId],
    ]);
    expect(unwrap(await store.read(runId, 1))).toHaveLength(1);
  });

  it('lists the runs that have not ended', async () => {
    const store = make();
    const [open, ended] = [newId<'AgentRun'>(), newId<'AgentRun'>()];
    unwrap(await store.append(open, 0, [started()]));
    unwrap(await store.append(ended, 0, [started(), done]));
    expect(unwrap(await store.openRuns())).toEqual([open]);
    expect(unwrap(await store.read(newId<'AgentRun'>()))).toEqual([]);
  });

  it('keeps a run closed when a saved-file card arrives after cancellation', async () => {
    const store = make();
    const runId = newId<'AgentRun'>();
    const toolRunId = newId<'ToolRun'>();
    const card = newEvent(
      'card.sent',
      {
        card: {
          type: 'toolRun',
          id: `cover:${toolRunId}`,
          version: 1,
          runId,
          toolRunId,
          tool: 'render.exportCover',
          status: 'succeeded',
          startedAt: 1,
          savedCover: { fileName: 'Cover.jpg', width: 1080, height: 1920, revision: 1 },
        },
      },
      3,
    );
    unwrap(await store.append(runId, 0, [started(), newEvent('run.cancelled', {}, 2), card]));
    expect(unwrap(await store.openRuns())).toEqual([]);
    expect(unwrap(await store.read(runId)).at(-1)?.type).toBe('card.sent');
  });
});

describe('file store durability', () => {
  it('drops a line torn by a crash and appends after the last good event', async () => {
    const dir = tempDir();
    const runId = newId<'AgentRun'>();
    unwrap(await createFileEventLogStore(dir).append(runId, 0, [started()]));
    appendFileSync(join(dir, `${runId}.jsonl`), '{"runId":"x","seq":1,"ty');
    const restarted = createFileEventLogStore(dir);
    expect(unwrap(await restarted.read(runId))).toHaveLength(1);
    expect(unwrap(await restarted.append(runId, 1, [done]))).toBe(1);
    expect(unwrap(await createFileEventLogStore(dir).read(runId)).map((e) => e.type)).toEqual([
      'run.started',
      'run.completed',
    ]);
    expect(readFileSync(join(dir, `${runId}.jsonl`), 'utf8')).not.toContain('"ty\n');
  });

  it.each([
    ['after a good event', 1],
    ['as the only line', 0],
  ])(
    'drops complete JSON a crash left without its newline (%s), and appends cleanly after it',
    async (_, kept) => {
      const dir = tempDir();
      const runId = newId<'AgentRun'>();
      const path = join(dir, `${runId}.jsonl`);
      if (kept) unwrap(await createFileEventLogStore(dir).append(runId, 0, [started()]));
      else writeFileSync(path, '');
      // Written in full but never acknowledged: the newline (and the fsync) never happened.
      const unacknowledged = { ...(kept ? done : started()), runId, seq: kept };
      appendFileSync(path, JSON.stringify(unacknowledged));

      const restarted = createFileEventLogStore(dir);
      expect(unwrap(await restarted.read(runId))).toHaveLength(kept);
      const next = kept ? done : started();
      expect(unwrap(await restarted.append(runId, kept, [next]))).toBe(kept);
      const reread = unwrap(await createFileEventLogStore(dir).read(runId));
      expect(reread.map((e) => e.seq)).toEqual(kept ? [0, 1] : [0]);
      expect(reread.at(-1)?.type).toBe(next.type);
      const lines = readFileSync(path, 'utf8').split('\n');
      expect(lines.at(-1)).toBe('');
      expect(lines).toHaveLength(kept + 2);
    },
  );

  it('reports a write it could not make', async () => {
    const dir = tempDir();
    const store = createFileEventLogStore(dir);
    rmSync(dir, { recursive: true });
    writeFileSync(dir, 'not a directory');
    const result = await store.append(newId<'AgentRun'>() as RunId, 0, [started()]);
    expect(!result.ok && result.error.code).toBe('agent.log_store_failed');
    rmSync(dir);
  });
});

describe('reading events', () => {
  it('rejects anything that is not an envelope', () => {
    expect(readEvent({ nope: true })).toBeUndefined();
    expect(readEvent({ runId: 'r', seq: -1, type: 'x', v: 1, at: 0, payload: {} })).toBeUndefined();
  });

  it('upcasts old payload versions step by step, and keeps unknown types', () => {
    const upcasters = {
      'run.completed': {
        1: (p: unknown) => ({ ...(p as object), did: ['legacy'] }),
        2: (p: unknown) => ({ ...(p as object), v3: true }),
      },
    };
    const event = readEvent(
      { runId: 'r', seq: 0, type: 'run.completed', v: 1, at: 0, payload: { report: 'x' } },
      upcasters,
    );
    expect(event).toMatchObject({ v: 3, payload: { report: 'x', did: ['legacy'], v3: true } });
    expect(readEvent({ runId: 'r', seq: 0, type: 'future.thing', v: 1, at: 0, payload: 1 })).toMatchObject({
      type: 'future.thing',
    });
  });
});

describe('the default cost estimator', () => {
  it('counts 4 characters a token and prices at the run’s own rate once it has one', () => {
    let spent = { tokens: 0, usd: 0 };
    const estimator = createDefaultCostEstimator(() => spent, { usdPerMillionTokens: 10 });
    expect(estimator.estimate({ promptChars: 4000, expectedOutputTokens: 1000 })).toEqual({
      tokens: 2000,
      usd: 0.02,
    });
    spent = { tokens: 1000, usd: 0.001 };
    expect(estimator.estimate({ promptChars: 4000, expectedOutputTokens: 1000 }).usd).toBeCloseTo(0.002, 10);
    expect(
      createDefaultCostEstimator(() => ({ tokens: 0, usd: 0 })).estimate({
        promptChars: 0,
        expectedOutputTokens: 1_000_000,
      }).usd,
    ).toBe(5);
  });
});
