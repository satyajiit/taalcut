// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L13 edges: assets gone mid-stage, cancelled jobs, huge outputs, the view, unknown needs, timings. */
import { createEventBus, ok, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  buildAssetIndexView,
  createIndexingPipeline,
  createRepositories,
  createStageRows,
  orderStages,
  pipelineTimings,
  stagePlan,
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
  return { db, clock, stub, queue, pipeline, rows: createStageRows(db), repos: createRepositories(db) };
}

describe('indexing edges', () => {
  it('ignores the result of an asset removed while its job ran (merged away by library.hash)', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['image', 'image']);
    const gone = assets[0]!;
    t.stub.handlers[KINDS.hash.kind] = async (input) => {
      if ((input as { assetId: AssetId }).assetId === gone) unwrap(t.repos.assets.remove(gone));
      return ok({});
    };
    await runPipeline(t.pipeline, t.queue);
    expect(t.rows.listByAsset(gone)).toEqual([]);
    expect(t.rows.listByAsset(assets[1]!).every((r) => r.state === 'done')).toBe(true);
  });

  it('puts a cancelled job’s stage back to waiting, so it is fed again', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['image']);
    await t.pipeline.tick();
    await t.pipeline.idle();
    const first = t.rows.get(assets[0]!, 'library.hash')!.jobId!;
    unwrap(await t.queue.cancel(first));
    await t.pipeline.idle();
    expect(t.rows.get(assets[0]!, 'library.hash')?.state).not.toBe('done');
    await runPipeline(t.pipeline, t.queue);
    expect(t.rows.get(assets[0]!, 'library.hash')?.state).toBe('done');
    expect(t.rows.get(assets[0]!, 'library.hash')?.jobId).not.toBe(first);
  });

  it('keeps no output over 1 MiB but still finishes the stage', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['image']);
    t.stub.handlers[KINDS.hash.kind] = async () => ok({ blob: 'x'.repeat(1_100_000) });
    await runPipeline(t.pipeline, t.queue);
    expect(t.rows.get(assets[0]!, 'library.hash')).toMatchObject({ state: 'done', output: null });
  });

  it('builds the view from a present original, the managed copy first', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video']);
    const id = assets[0]!;
    const phone = unwrap(
      t.repos.sources.add({ kind: 'wifi_import', displayName: 'iPhone', rootPath: '/Users/test/Originals' }),
    );
    unwrap(
      t.repos.assetLocations.add({
        assetId: id,
        sourceId: phone.id,
        storage: 'managed',
        relativePath: '2026/clip.mov',
        sizeBytes: 1000,
        state: 'present',
      }),
    );
    const outcome = buildAssetIndexView(t.db, id);
    expect(outcome.kind === 'view' && outcome.view).toMatchObject({
      path: '/Users/test/Originals/2026/clip.mov',
      sourceId: phone.id,
      contentHash: '',
      facts: null,
      shots: [],
      transcript: null,
      outputs: {},
    });
    expect(buildAssetIndexView(t.db, 'nope' as AssetId)).toEqual({ kind: 'gone' });
  });

  it('orders stages by need and treats an unregistered need as met', async () => {
    const t = await setup();
    const reversed = [...t.stub.stages].reverse();
    expect(orderStages(reversed).map((s) => s.stage)).toEqual(t.stub.stages.map((s) => s.stage));
    const embed = t.stub.stages.find((s) => s.stage === 'vision.embed')!;
    const plan = stagePlan({ ...embed, needs: [...embed.needs, 'other.missing'] }, t.stub.stages);
    expect(plan.needs.map((n) => n.stage)).not.toContain('other.missing');
    // An image skips vision.shots but vision.analyse still waits for media.normalise.
    const analyse = stagePlan(
      t.stub.stages.find((s) => s.stage === 'vision.analyse')!,
      t.stub.stages,
    );
    expect(analyse.needs).toEqual(
      expect.arrayContaining([
        { stage: 'vision.shots', appliesTo: ['video', 'live_photo'] },
        { stage: 'media.normalise', appliesTo: ['image'] },
      ]),
    );
    expect(() => orderStages([...t.stub.stages, t.stub.stages[0]!])).toThrow(/share a name/);
  });

  it('gives the benchmark per-stage and total times', async () => {
    const t = await setup();
    const started = t.clock.now();
    addAssets(t.db, ['image', 'video']);
    for (const kind of Object.values(KINDS)) {
      const run = t.stub.handlers[kind.kind]!;
      t.stub.handlers[kind.kind] = async (input, jobId) => {
        t.clock.advance(100);
        return run(input, jobId);
      };
    }
    await runPipeline(t.pipeline, t.queue);
    const timings = pipelineTimings(t.db, started);
    expect(timings.assets).toBe(2);
    expect(timings.completeAssets).toBe(2);
    const hash = timings.stages.find((s) => s.stage === 'library.hash')!;
    expect(hash).toMatchObject({ runs: 2, meanMs: 100, p95Ms: 100, totalMs: 200 });
    expect(timings.wallMs).toBeGreaterThanOrEqual(1000);
    expect(pipelineTimings(t.db, t.clock.now() + 1)).toMatchObject({ assets: 0, stages: [], wallMs: 0 });
  });
});
