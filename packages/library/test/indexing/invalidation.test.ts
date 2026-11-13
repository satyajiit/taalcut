// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-I3, dependent invalidation through the real pipeline: a stage that runs again and stores something else
 * sends the stages that read it back to waiting, and one that stores the same thing sends none; a reader whose
 * input changed gets a new job; a skip that clears vectors removes them (text gone, a clip turned silent).
 */
import { createEventBus, systemClock, unwrap, type AssetId, type IndexStageDefinition } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createIndexingPipeline,
  createStageRows,
  openVectorIndex,
  sqliteVecPath,
  type LibraryDatabase,
} from '../../src/index';
import { openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { readingStages, risen, type World } from './reading-stages';

const VISION_READERS = ['vision.analyse', 'vision.ocr', 'vision.embed', 'vision.describe'];

async function setup(start: Partial<World> = {}) {
  const world: World = { cuts: [150], text: {}, silent: false, ...start };
  const db = openTestDb({ file: false, extensions: [sqliteVecPath()] });
  const vectors = unwrap(openVectorIndex(db, { name: 'stub', dimensions: 8 }));
  const events = createEventBus({ clock: systemClock });
  const reading = readingStages(db, vectors, world);
  const queue = createTestQueue(db, events, reading.handlers);
  const [asset] = addAssets(db, ['video']).assets as [AssetId];
  const runs = (stage: string) => reading.runs.get(`${stage} ${asset}`) ?? 0;
  const index = async (stages: IndexStageDefinition[] = reading.stages) => {
    const pipeline = createIndexingPipeline({
      db,
      queue,
      events,
      stages,
      vectors: () => vectors,
      log: () => {},
    });
    await pipeline.start({ poll: false });
    try {
      await runPipeline(pipeline, queue);
    } finally {
      pipeline.stop();
    }
  };
  const ids = (kind: string) =>
    (
      db.driver
        .prepare(`SELECT item_id AS id FROM vec_stub WHERE asset_id = ? AND kind = ?`)
        .all(asset, kind) as {
        id: string;
      }[]
    )
      .map((row) => row.id)
      .sort();
  const shotIds = () =>
    (
      db.driver.prepare('SELECT id FROM shots WHERE asset_id = ? ORDER BY index_in_asset').all(asset) as {
        id: string;
      }[]
    ).map((row) => row.id);
  await index();
  return { db, world, reading, asset, runs, index, ids, shotIds, rows: createStageRows(db) };
}

const digests = (db: LibraryDatabase) =>
  Object.fromEntries(
    (
      db.driver.prepare('SELECT stage, output_digest AS d FROM asset_index_stages ORDER BY stage').all() as {
        stage: string;
        d: string | null;
      }[]
    ).map((row) => [row.stage, row.d]),
  );

describe('dependent invalidation (IX3-I3)', () => {
  it('keeps a digest only for stages another stage reads', async () => {
    const t = await setup();
    const kept = digests(t.db);
    for (const stage of [
      'media.normalise',
      'vision.shots',
      'vision.analyse',
      'vision.ocr',
      'audio.transcript',
    ])
      expect(kept[stage], stage).toMatch(/^[0-9a-f]{64}$/);
    for (const stage of [
      'library.hash',
      'vision.embed',
      'vision.embedOcr',
      'vision.embedText',
      'vision.describe',
    ])
      expect(kept[stage], stage).toBeNull();
  });

  it('re-runs nothing that reads a stage which stored the same thing again, twice', async () => {
    const t = await setup();
    const before = digests(t.db);
    await t.index(risen(t.reading.stages, ['vision.shots']));
    await t.index(risen(risen(t.reading.stages, ['vision.shots']), ['vision.shots']));
    expect(t.runs('vision.shots')).toBe(3);
    for (const stage of VISION_READERS) expect(t.runs(stage), stage).toBe(1);
    expect(digests(t.db)).toEqual(before);
    for (const row of t.rows.listByAsset(t.asset)) expect(row.state, row.stage).toMatch(/done|skipped/);
  });

  it('re-runs the stages that read new shots, and leaves the speech side alone', async () => {
    const t = await setup({ text: { 0: ['SALE'] } });
    t.world.cuts = [90, 200];
    await t.index(risen(t.reading.stages, ['vision.shots']));
    for (const stage of VISION_READERS) expect(t.runs(stage), stage).toBe(2);
    // Shot 0 kept its id and its text, so what vision.ocr stores didn't change: its vectors stay as they were.
    expect(t.runs('vision.embedOcr')).toBe(1);
    expect(t.runs('audio.transcript')).toBe(1);
    expect(t.runs('vision.embedText')).toBe(1);
  });

  it('a version rise that stores the same shots re-runs only that stage; one with new shots re-runs readers', async () => {
    // As a VISION_CONFIG.version rise does: it raises the detector's and the analysis's own versions.
    const t = await setup();
    await t.index(risen(t.reading.stages, ['vision.shots', 'vision.analyse']));
    expect([t.runs('vision.embed'), t.runs('vision.describe')]).toEqual([1, 1]);
    t.world.cuts = [100];
    await t.index(risen(risen(t.reading.stages, ['vision.shots', 'vision.analyse']), ['vision.shots']));
    expect([t.runs('vision.embed'), t.runs('vision.describe')]).toEqual([2, 2]);
  });

  it('drops the vectors of text that is gone: a shot’s, then the last', async () => {
    const t = await setup({ text: { 0: ['SALE'], 1: ['NEW SETUP'] } });
    const [first, second] = t.shotIds();
    expect(t.ids('ocr')).toEqual([`ocr:${first}:0`, `ocr:${second}:0`].sort());
    t.world.text = { 0: ['SALE'] };
    await t.index(risen(t.reading.stages, ['vision.ocr']));
    expect(t.runs('vision.embedOcr')).toBe(2);
    expect(t.ids('ocr')).toEqual([`ocr:${first}:0`]);
    t.world.text = {};
    await t.index(risen(risen(t.reading.stages, ['vision.ocr']), ['vision.ocr']));
    expect(t.rows.get(t.asset, 'vision.embedOcr')).toMatchObject({
      state: 'skipped',
      reasonKey: 'indexing.skip.noText',
    });
    expect(t.ids('ocr')).toEqual([]);
    expect(t.runs('vision.embedOcr')).toBe(2);
  });

  it('drops a clip’s transcript vectors once it turns silent', async () => {
    const t = await setup();
    expect(t.ids('transcript')).toEqual([`transcript:${t.asset}:0`]);
    t.world.silent = true;
    await t.index(risen(t.reading.stages, ['audio.transcript']));
    expect(t.rows.get(t.asset, 'vision.embedText')).toMatchObject({
      state: 'skipped',
      reasonKey: 'indexing.skip.silent',
    });
    expect(t.ids('transcript')).toEqual([]);
    expect(t.runs('vision.embedText')).toBe(1);
  });

  it('gives a reader whose input changed a new job, not its earlier run’s finished one', async () => {
    const t = await setup({ text: { 0: ['SALE'] } });
    const keys = () =>
      (
        t.db.driver.prepare(`SELECT idempotency_key AS k FROM jobs WHERE kind = 'test.embedTexts'`).all() as {
          k: string;
        }[]
      ).map((row) => row.k);
    const first = keys();
    t.world.text = { 0: ['SALE NOW'] };
    await t.index(risen(t.reading.stages, ['vision.ocr']));
    const second = keys();
    expect(second).toHaveLength(first.length + 1);
    expect(new Set(second).size).toBe(second.length);
    expect(t.runs('vision.embedOcr')).toBe(2);
  });
});
