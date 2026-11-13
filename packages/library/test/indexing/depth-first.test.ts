// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-S4 (design B): depth-first indexing. Each job carries its asset's import order as its order key and
 * the pipeline feeds by asset, so among stages of one priority the first file goes all the way before the
 * third starts its second stage. `indexing.prioritise` still wins. The test queue runs one job at a time
 * and lets the pipeline settle in between, as the engine's after-job step does.
 */
import { createEventBus, unwrap, type AssetId, type IndexStageDefinition } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createIndexingPipeline, createJobRepository, createStageRows } from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { KINDS, stubStages } from './stages';

/** The searchable stages share one priority (the ready lane's milestone rule): order keys decide. */
const searchableAtOnePriority = (stages: readonly IndexStageDefinition[]): IndexStageDefinition[] =>
  stages.map((stage) => ({ ...stage, priority: 'normal' }));

async function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const events = createEventBus({ clock: { now: clock.now } });
  const stub = stubStages(db);
  const queue = createTestQueue(db, events, stub.handlers);
  const stages = searchableAtOnePriority(stub.stages);
  const pipeline = createIndexingPipeline({ db, queue, events, stages, log: () => {} });
  await pipeline.start({ poll: false });
  return { db, queue, pipeline, rows: createStageRows(db) };
}

describe('depth-first indexing', () => {
  it('takes asset 1 to its last stage before asset 3 starts its second', async () => {
    const t = await setup();
    // One scan batch: the three share a created_at, so import order comes from the insert order.
    const { assets } = addAssets(t.db, ['video', 'video', 'video']);
    const [first, , third] = assets as [AssetId, AssetId, AssetId];
    await runPipeline(t.pipeline, t.queue);
    const ran = t.queue.ran;
    const lastOfFirst = ran.lastIndexOf(`${KINDS.embed.kind} ${first}`);
    const thirdStages = ran.filter((line) => line.endsWith(third));
    const secondOfThird = ran.indexOf(thirdStages[1]!);
    expect(lastOfFirst).toBeGreaterThanOrEqual(0);
    expect(secondOfThird).toBeGreaterThan(lastOfFirst);
    // Every asset ran every stage once.
    expect(ran).toHaveLength(3 * 6);
    for (const id of assets) expect(t.rows.get(id, 'vision.embed')?.state).toBe('done');
  });

  it('gives each job its asset’s import order as the order key', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['image', 'image']);
    await t.pipeline.tick();
    await t.pipeline.idle();
    const jobs = createJobRepository(t.db);
    const keys = assets.map((id) => unwrap(jobs.get(t.rows.get(id, 'library.hash')!.jobId!)).orderKey);
    expect(keys.every((key) => typeof key === 'number')).toBe(true);
    expect(keys[0]!).toBeLessThan(keys[1]!);
  });

  it('still puts a prioritised asset ahead of earlier imports', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['image', 'image', 'image']);
    const last = assets[2]!;
    await t.pipeline.tick(); // seeded and fed: every hash job is queued with its order key
    await t.pipeline.idle();
    unwrap(await t.pipeline.prioritise([last]));
    await runPipeline(t.pipeline, t.queue);
    const ofLast = t.queue.ran.filter((line) => line.endsWith(last));
    expect(t.queue.ran.slice(0, ofLast.length)).toEqual(ofLast);
  });
});
