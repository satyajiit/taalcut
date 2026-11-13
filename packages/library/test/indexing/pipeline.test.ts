// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L13: stages run in dependency order, skip what doesn't apply, store results, follow generations. */
import {
  createEventBus,
  err,
  unwrap,
  ValidationError,
  type AssetId,
  type IndexStageDefinition,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assetDetail,
  createIndexingPipeline,
  createRepositories,
  createStageRows,
  MODEL_MISSING,
  ORIGINAL_OFFLINE,
  reindexAssets,
  type LibraryDatabase,
} from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { KINDS, stubStages, type StubOptions } from './stages';

/** Follows job events without the poll timer: the tests tick by hand. */
async function follow(pipeline: { start(options: { poll: boolean }): Promise<void> }) {
  await pipeline.start({ poll: false });
}

async function setup(
  options: StubOptions & {
    maxQueuedPerStage?: number;
    notReady?: (stage: string) => string | undefined;
  } = {},
) {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const events = createEventBus({ clock: { now: clock.now } });
  const stub = stubStages(db, options);
  const queue = createTestQueue(db, events, stub.handlers);
  const make = async (stages: IndexStageDefinition[] = stub.stages) => {
    const pipeline = createIndexingPipeline({
      db,
      queue,
      events,
      stages,
      ...(options.maxQueuedPerStage ? { maxQueuedPerStage: options.maxQueuedPerStage } : {}),
      ...(options.notReady ? { notReady: options.notReady } : {}),
      log: () => {},
    });
    await follow(pipeline);
    return pipeline;
  };
  const pipeline = await make();
  return { db, clock, events, stub, queue, pipeline, make, rows: createStageRows(db) };
}

const states = (db: LibraryDatabase, assetId: AssetId) =>
  Object.fromEntries(
    createStageRows(db)
      .listByAsset(assetId)
      .map((r) => [r.stage, r.state]),
  );

describe('indexing pipeline', () => {
  it('runs each stage after its needs and only where it applies', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video', 'image', 'audio']);
    const [video, image, audio] = assets as [AssetId, AssetId, AssetId];
    await runPipeline(t.pipeline, t.queue);

    expect(states(t.db, video)).toEqual({
      'library.hash': 'done',
      'media.normalise': 'done',
      'vision.shots': 'done',
      'vision.analyse': 'done',
      'audio.transcript': 'done',
      'vision.embed': 'done',
    });
    expect(Object.keys(states(t.db, image)).sort()).toEqual([
      'library.hash',
      'media.normalise',
      'vision.analyse',
      'vision.embed',
    ]);
    expect(Object.keys(states(t.db, audio)).sort()).toEqual([
      'audio.transcript',
      'library.hash',
      'media.normalise',
      'vision.embed',
    ]);
    const order = (kind: string, id: AssetId) => t.queue.ran.indexOf(`${kind} ${id}`);
    for (const id of assets) {
      expect(order(KINDS.hash.kind, id)).toBeLessThan(order(KINDS.normalise.kind, id));
      expect(order(KINDS.normalise.kind, id)).toBeLessThan(order(KINDS.embed.kind, id));
    }
    expect(order(KINDS.shots.kind, video)).toBeLessThan(order(KINDS.analyse.kind, video));
    expect(order(KINDS.analyse.kind, video)).toBeLessThan(order(KINDS.embed.kind, video));
    expect(order(KINDS.transcript.kind, video)).toBeLessThan(order(KINDS.embed.kind, video));
    // Every job ran once.
    expect([...t.stub.runs.values()].every((n) => n === 1)).toBe(true);

    // Results are stored: facts, shots with analyses, the transcript and its language.
    const detail = unwrap(assetDetail(t.db, video));
    // No stub stage is searchable, so the video became searchable when it was complete (milestones.test.ts).
    expect(detail.asset.index).toEqual({
      state: 'done',
      done: 6,
      total: 6,
      searchableAt: expect.any(Number),
    });
    expect(detail.facts?.orientation).toBe('portrait');
    expect(detail.shots).toHaveLength(2);
    expect(detail.shots.every((s) => s.analysis !== null)).toBe(true);
    expect(detail.transcript?.language).toBe('en');
    expect(detail.asset.language).toBe('en');
    // Outputs are kept for later stages.
    expect(createStageRows(t.db).get(video, 'library.hash')?.output).toMatchObject({
      contentHash: expect.any(String),
    });
  });

  it('marks a stage skipped when its job() says so; dependants still run', async () => {
    const silent = new Set<AssetId>();
    const t = await setup({ silent });
    const { assets } = addAssets(t.db, ['video', 'video']);
    silent.add(assets[0]!);
    await runPipeline(t.pipeline, t.queue);
    expect(t.rows.get(assets[0]!, 'audio.transcript')).toMatchObject({
      state: 'skipped',
      reasonKey: 'audio.stage.noAudioTrack',
    });
    expect(t.stub.runs.get(`${KINDS.transcript.kind} ${assets[0]}`)).toBeUndefined();
    expect(t.rows.get(assets[1]!, 'audio.transcript')?.state).toBe('done');
    expect(states(t.db, assets[0]!)['vision.embed']).toBe('done');
  });

  it('drops a result for an older generation and runs the stage again', async () => {
    const t = await setup();
    await follow(t.pipeline);
    const { assets } = addAssets(t.db, ['video']);
    const id = assets[0]!;
    await t.pipeline.tick();
    await t.queue.runNext(); // library.hash
    await t.pipeline.idle();
    await t.pipeline.tick(); // media.normalise queued
    await t.pipeline.idle();
    const first = t.rows.get(id, 'media.normalise')!;
    expect(first.state).toBe('queued');
    unwrap(createRepositories(t.db).assets.reindex([id])); // generation 1, the row still follows the job
    await t.queue.runNext(); // normalise ran for generation 0
    await t.pipeline.idle();
    // Its result was dropped and the stage queued again, for generation 1.
    const again = t.rows.get(id, 'media.normalise')!;
    expect(again).toMatchObject({ state: 'queued', generation: 1 });
    expect(again.jobId).not.toBe(first.jobId);
    expect(unwrap(createRepositories(t.db).assets.get(id)).facts).toBeNull();
    await runPipeline(t.pipeline, t.queue);
    expect(t.stub.runs.get(`${KINDS.normalise.kind} ${id}`)).toBe(2);
    expect(t.rows.get(id, 'media.normalise')).toMatchObject({ state: 'done', generation: 1 });
  });

  it('re-indexes from the generation on, keeping library.hash', async () => {
    const t = await setup();
    await follow(t.pipeline);
    const { assets } = addAssets(t.db, ['video']);
    const id = assets[0]!;
    await runPipeline(t.pipeline, t.queue);
    expect(unwrap(reindexAssets(t.db, [id]))).toBe(1);
    expect(states(t.db, id)).toMatchObject({ 'library.hash': 'done', 'vision.embed': 'waiting' });
    await runPipeline(t.pipeline, t.queue);
    expect(t.stub.runs.get(`${KINDS.hash.kind} ${id}`)).toBe(1);
    expect(t.stub.runs.get(`${KINDS.embed.kind} ${id}`)).toBe(2);
    expect(Object.values(states(t.db, id)).every((s) => s === 'done')).toBe(true);
    // Shots kept their ids: same ranges on re-detection.
    expect(createRepositories(t.db).shots.listByAsset(id)).toHaveLength(2);
  });

  it('fails a stage with its public error, holds its dependants and retries on request', async () => {
    const t = await setup();
    await follow(t.pipeline);
    const { assets } = addAssets(t.db, ['image']);
    const id = assets[0]!;
    const real = t.stub.handlers[KINDS.normalise.kind]!;
    let broken = true;
    t.stub.handlers[KINDS.normalise.kind] = (input, jobId) =>
      broken ? err(ValidationError({ field: 'x' }, { detail: '/Users/me/secret path' })) : real(input, jobId);
    await runPipeline(t.pipeline, t.queue);
    const row = t.rows.get(id, 'media.normalise')!;
    expect(row.state).toBe('failed');
    expect(row.error).toMatchObject({ code: 'core.validation' });
    expect(JSON.stringify(row.error)).not.toContain('secret');
    expect(t.rows.get(id, 'vision.analyse')?.state).toBe('waiting');
    broken = false;
    expect(unwrap(await t.pipeline.retryFailed())).toEqual({ requeued: 1 });
    await runPipeline(t.pipeline, t.queue);
    expect(Object.values(states(t.db, id)).every((s) => s === 'done')).toBe(true);
  });

  it('keeps at most N queued jobs per stage', async () => {
    const t = await setup({ maxQueuedPerStage: 2 });
    addAssets(t.db, ['image', 'image', 'image', 'image', 'image']);
    await t.pipeline.tick();
    await t.pipeline.idle();
    expect(t.rows.queuedCount('library.hash')).toBe(2);
    expect(unwrap(await t.queue.list({ states: ['queued'] }))).toHaveLength(2);
  });

  it('waits while the original is offline and runs once it is back', async () => {
    const t = await setup();
    await follow(t.pipeline);
    const { assets } = addAssets(t.db, ['image'], { state: 'offline' });
    const id = assets[0]!;
    await runPipeline(t.pipeline, t.queue);
    expect(t.rows.get(id, 'library.hash')).toMatchObject({ state: 'waiting', reasonKey: ORIGINAL_OFFLINE });
    const [location] = createRepositories(t.db).assetLocations.listByAsset(id);
    unwrap(createRepositories(t.db).assetLocations.setState(location!.id, 'present'));
    await runPipeline(t.pipeline, t.queue);
    expect(Object.values(states(t.db, id)).every((s) => s === 'done')).toBe(true);
  });

  it('keeps a stage that cannot run yet waiting with its reason, and runs it once it can', async () => {
    let modelInstalled = false;
    const t = await setup({
      notReady: (stage) => (stage === 'vision.embed' && !modelInstalled ? MODEL_MISSING : undefined),
    });
    const { assets } = addAssets(t.db, ['image']);
    const id = assets[0]!;
    await runPipeline(t.pipeline, t.queue);
    expect(t.rows.get(id, 'vision.embed')).toMatchObject({ state: 'waiting', reasonKey: MODEL_MISSING });
    expect(t.rows.get(id, 'vision.analyse')?.state).toBe('done');
    expect(t.stub.runs.get(`${KINDS.embed.kind} ${id}`)).toBeUndefined();
    modelInstalled = true;
    await runPipeline(t.pipeline, t.queue);
    expect(t.rows.get(id, 'vision.embed')).toMatchObject({ state: 'done', reasonKey: null });
  });

  it('reruns a stage whose definition version rose, at low priority, once the queue is idle', async () => {
    const t = await setup();
    await follow(t.pipeline);
    const { assets } = addAssets(t.db, ['image', 'image']);
    await runPipeline(t.pipeline, t.queue);
    t.pipeline.stop();
    const bumped = await t.make(
      t.stub.stages.map((s) => (s.stage === 'vision.analyse' ? { ...s, version: 2 } : s)),
    );
    await runPipeline(bumped, t.queue);
    for (const id of assets) {
      expect(t.stub.runs.get(`${KINDS.analyse.kind} ${id}`)).toBe(2);
      expect(t.rows.get(id, 'vision.analyse')).toMatchObject({ state: 'done', version: 2, priority: -1 });
      expect(t.stub.runs.get(`${KINDS.normalise.kind} ${id}`)).toBe(1);
    }
  });
});
