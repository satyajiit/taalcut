// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L13 "what the user waits for runs first": by default hashing and facts
 * (normal) run before shots, analysis and embeddings (low), so the grid fills
 * before search deepens; `indexing.prioritise` puts an asset's remaining
 * stages ahead of everything for 10 minutes, raising its queued jobs in place.
 */
import { createEventBus, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createIndexingPipeline,
  createJobRepository,
  createStageRows,
  JOB_PRIORITY_VALUES,
} from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { KINDS, stubStages } from './stages';

async function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const events = createEventBus({ clock: { now: clock.now } });
  const stub = stubStages(db);
  const queue = createTestQueue(db, events, stub.handlers);
  const pipeline = createIndexingPipeline({ db, queue, events, stages: stub.stages, log: () => {} });
  await pipeline.start({ poll: false });
  return { db, clock, queue, pipeline, rows: createStageRows(db) };
}

const NORMAL = new Set([KINDS.hash.kind, KINDS.normalise.kind]);

describe('indexing priorities', () => {
  it('runs hashing and facts before shots, analysis and embeddings', async () => {
    const t = await setup();
    addAssets(t.db, ['video', 'video', 'image']);
    await runPipeline(t.pipeline, t.queue);
    const kinds = t.queue.ran.map((line) => line.split(' ')[0]!);
    const lastNormal = Math.max(...kinds.map((k, i) => (NORMAL.has(k) ? i : -1)));
    const firstLow = kinds.findIndex((k) => !NORMAL.has(k));
    expect(lastNormal).toBeLessThan(firstLow);
  });

  it('puts a prioritised asset first, raising its queued job in place', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['image', 'image', 'image']);
    const [a, b, c] = assets as [AssetId, AssetId, AssetId];
    await t.pipeline.tick();
    await t.pipeline.idle();
    const job = (id: AssetId) =>
      unwrap(createJobRepository(t.db).get(t.rows.get(id, 'library.hash')!.jobId!));
    expect([job(a).priority, job(c).priority]).toEqual([0, 0]);

    expect(unwrap(await t.pipeline.prioritise([c]))).toEqual({ boosted: 1 });
    // The jobs column has one scale: a boosted job is as high as a `high` kind (media.probe), not below it.
    expect(job(c).priority).toBe(JOB_PRIORITY_VALUES.high);
    expect(JOB_PRIORITY_VALUES).toEqual({ low: -10, normal: 0, high: 10 });
    expect(job(a).priority).toBe(0);
    await runPipeline(t.pipeline, t.queue);
    // All of c's stages ran before the others' first.
    const ofC = t.queue.ran.filter((line) => line.endsWith(c));
    expect(t.queue.ran.slice(0, ofC.length)).toEqual(ofC);
    expect(ofC.map((line) => line.split(' ')[0])).toEqual([
      KINDS.hash.kind,
      KINDS.normalise.kind,
      KINDS.analyse.kind,
      KINDS.embed.kind,
    ]);
    expect(t.rows.get(c, 'vision.analyse')?.priority).toBe(1);
    expect(t.rows.get(b, 'vision.analyse')?.priority).toBe(-1);
  });

  it('stops boosting after 10 minutes', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['image']);
    const id = assets[0]!;
    unwrap(await t.pipeline.prioritise([id]));
    t.clock.advance(11 * 60_000);
    await runPipeline(t.pipeline, t.queue);
    expect(t.rows.get(id, 'library.hash')?.priority).toBe(0);
    expect(t.rows.get(id, 'vision.analyse')?.priority).toBe(-1);
  });
});
