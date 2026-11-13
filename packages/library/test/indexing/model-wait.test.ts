// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX1-IMPORT: a job that finds its on-device model missing doesn't fail the file. Two phone videos whose
 * language stage failed with `audio.model_missing` read "2 files couldn't be read"; now the stage waits for its
 * model (held), the rest of it waits too without a job each, one row is tried again now and then, and the stage
 * runs once the model is there. Try again releases it at once; rows an older build failed are held at start.
 */
import { createEventBus, defineError, err, unwrap, ValidationError, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assetDetail,
  createIndexingPipeline,
  createStageRows,
  indexingStatus,
  MODEL_MISSING,
  browseAssets,
} from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { KINDS, stubStages } from './stages';

const SpeechModelMissing = defineError<{ component: string }>('test.model_missing');
const PROBE_MS = 60_000;

async function setup(options: { readonly notReady?: (stage: string) => string | undefined } = {}) {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const events = createEventBus({ clock: { now: clock.now } });
  const stub = stubStages(db);
  let installed = false;
  let tries = 0;
  const transcribe = stub.handlers[KINDS.transcript.kind]!;
  stub.handlers[KINDS.transcript.kind] = (input, jobId) => {
    tries++;
    return installed ? transcribe(input, jobId) : err(SpeechModelMissing({ component: 'whisper-tiny' }));
  };
  const queue = createTestQueue(db, events, stub.handlers);
  const pipeline = createIndexingPipeline({
    db,
    queue,
    events,
    stages: stub.stages,
    modelProbeMs: PROBE_MS,
    ...(options.notReady ? { notReady: options.notReady } : {}),
    log: () => {},
  });
  await pipeline.start({ poll: false });
  const run = () => runPipeline(pipeline, queue);
  return {
    db,
    clock,
    pipeline,
    run,
    rows: createStageRows(db),
    install: () => (installed = true),
    tries: () => tries,
  };
}

const transcriptStates = (t: Awaited<ReturnType<typeof setup>>, ids: readonly AssetId[]) =>
  ids.map((id) => t.rows.get(id, 'audio.transcript')?.state);

describe('a stage whose model is missing', () => {
  it('waits for the model instead of failing the file', async () => {
    const t = await setup();
    const { sourceId, assets } = addAssets(t.db, ['video', 'video', 'video']);
    await t.run();

    const first = t.rows.get(assets[0]!, 'audio.transcript');
    expect(first).toMatchObject({ state: 'waiting', reasonKey: MODEL_MISSING });
    expect(first?.error).toMatchObject({ code: 'test.model_missing', params: { component: 'whisper-tiny' } });
    // The others wait with the same reason; vision.embed (which needs the transcript) waits behind it.
    for (const id of assets) {
      expect(t.rows.get(id, 'audio.transcript')).toMatchObject({
        state: 'waiting',
        reasonKey: MODEL_MISSING,
      });
      expect(t.rows.get(id, 'vision.embed')?.state).toBe('waiting');
      expect(t.rows.get(id, 'vision.analyse')?.state).toBe('done');
    }

    const status = indexingStatus(t.db, { paused: false });
    expect(status.overall).toMatchObject({ assets: 3, failed: 0, waiting: 3 });
    const source = status.sources.find((s) => s.sourceId === sourceId);
    expect(source?.counts.failed).toBe(0);
    // UX3-IDX: the import says what waits for a download; a stage behind it waits with no count of its own.
    const stage = (name: string) => source?.stages.find((s) => s.stage === name);
    expect(stage('audio.transcript')).toMatchObject({ left: 3, failed: 0, waitingForModel: 3 });
    expect(stage('vision.embed')).not.toHaveProperty('waitingForModel');
    expect(unwrap(assetDetail(t.db, assets[0]!)).asset.index.state).toBe('waiting');
    expect(unwrap(browseAssets(t.db, { filters: { indexStates: ['failed'] } })).total).toBe(0);
  });

  it('feeds no job per clip while it waits, and tries one now and then', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video', 'video', 'video']);
    await t.run();
    const afterImport = t.tries();
    expect(afterImport).toBeGreaterThanOrEqual(1);

    await t.run();
    t.clock.advance(PROBE_MS / 2);
    await t.run();
    expect(t.tries()).toBe(afterImport);

    t.clock.advance(PROBE_MS);
    await t.run();
    expect(t.tries()).toBe(afterImport + 1);
    expect(transcriptStates(t, assets).every((state) => state === 'waiting')).toBe(true);
  });

  it('runs every clip once a probe finds the model', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video', 'video', 'video']);
    await t.run();
    t.install();
    t.clock.advance(PROBE_MS + 1);
    await t.run();
    for (const id of assets) {
      expect(t.rows.get(id, 'audio.transcript')).toMatchObject({
        state: 'done',
        reasonKey: null,
        error: null,
      });
      expect(t.rows.get(id, 'vision.embed')?.state).toBe('done');
    }
    expect(indexingStatus(t.db, { paused: false }).overall).toMatchObject({ done: 3, waiting: 0, failed: 0 });
  });

  it('runs at once on Try again', async () => {
    const t = await setup();
    const { sourceId, assets } = addAssets(t.db, ['video', 'video']);
    await t.run();
    t.install();
    expect(unwrap(await t.pipeline.retryFailed(sourceId)).requeued).toBeGreaterThanOrEqual(1);
    await t.run();
    expect(transcriptStates(t, assets)).toEqual(['done', 'done']);
  });

  it('holds a row an older build failed for a missing model, and keeps other failures failed', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video', 'video']);
    t.install();
    await t.run();
    const [old, broken] = assets as [AssetId, AssetId];
    const model = { code: 'audio.model_missing', messageKey: 'errors.audio.model_missing', retryable: false };
    t.rows.failed(old, 'audio.transcript', ValidationError({ field: 'x' }));
    t.db.driver
      .prepare(`UPDATE asset_index_stages SET error = ? WHERE asset_id = ? AND stage = 'audio.transcript'`)
      .run(JSON.stringify(model), old);
    t.rows.failed(broken, 'audio.transcript', ValidationError({ field: 'x' }));

    await t.pipeline.reconcile();
    expect(t.rows.get(old, 'audio.transcript')).toMatchObject({ state: 'waiting', reasonKey: MODEL_MISSING });
    expect(t.rows.get(broken, 'audio.transcript')?.state).toBe('failed');
    expect(indexingStatus(t.db, { paused: false }).overall.failed).toBe(1);
  });
});

describe('an install (UX2-MODELS)', () => {
  it('re-queues a held stage at once: one row probes, then every clip runs, without waiting for the probe', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video', 'video', 'video']);
    await t.run();
    const before = t.tries();
    expect(transcriptStates(t, assets).every((state) => state === 'waiting')).toBe(true);

    t.install();
    await t.pipeline.modelsInstalled();
    // The probe row went to the queue at once: no clock moved.
    expect(t.rows.get(assets[0]!, 'audio.transcript')?.state).toBe('queued');
    await t.run();
    for (const id of assets)
      expect(t.rows.get(id, 'audio.transcript')).toMatchObject({
        state: 'done',
        reasonKey: null,
        error: null,
      });
    expect(t.tries()).toBe(before + assets.length);
  });

  it('of another model tries one row only, and the stage keeps waiting', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video', 'video', 'video']);
    await t.run();
    const before = t.tries();

    await t.pipeline.modelsInstalled();
    await t.run();
    expect(t.tries()).toBe(before + 1);
    await t.run();
    expect(t.tries()).toBe(before + 1);
    expect(transcriptStates(t, assets).every((state) => state === 'waiting')).toBe(true);
    expect(t.rows.get(assets[0]!, 'audio.transcript')?.reasonKey).toBe(MODEL_MISSING);
  });

  it('runs a stage notReady held back once notReady lets it', async () => {
    let embedder = false;
    const t = await setup({
      notReady: (stage) => (stage === 'vision.embed' && !embedder ? MODEL_MISSING : undefined),
    });
    t.install();
    const { assets } = addAssets(t.db, ['video', 'video']);
    await t.run();
    for (const id of assets)
      expect(t.rows.get(id, 'vision.embed')).toMatchObject({ state: 'waiting', reasonKey: MODEL_MISSING });

    embedder = true;
    await t.pipeline.modelsInstalled();
    expect(assets.map((id) => t.rows.get(id, 'vision.embed')?.state)).toEqual(['queued', 'queued']);
    await t.run();
    for (const id of assets)
      expect(t.rows.get(id, 'vision.embed')).toMatchObject({ state: 'done', reasonKey: null });
  });
});
