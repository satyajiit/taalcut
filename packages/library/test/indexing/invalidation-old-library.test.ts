// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX3-I3 for libraries from before migration 27 (every digest null, as the migration leaves them): the first run
 * records the digests of what is stored and re-runs nothing, and a version rise after that compares with what the
 * stage had stored. Plus the registry check the pipeline runs on its stage list.
 */
import {
  createEventBus,
  ok,
  systemClock,
  unwrap,
  type AssetId,
  type IndexStageDefinition,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  checkStageReads,
  createIndexingPipeline,
  createInvalidation,
  openVectorIndex,
  sqliteVecPath,
  type LibraryDatabase,
} from '../../src/index';
import { openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { readingStages, risen, type World } from './reading-stages';

const READERS = ['vision.analyse', 'vision.ocr', 'vision.embed', 'vision.describe'];

async function indexedLibrary() {
  const world: World = { cuts: [150], text: { 0: ['SALE'] }, silent: false };
  const db = openTestDb({ file: false, extensions: [sqliteVecPath()] });
  const vectors = unwrap(openVectorIndex(db, { name: 'stub', dimensions: 8 }));
  const events = createEventBus({ clock: systemClock });
  const reading = readingStages(db, vectors, world);
  const queue = createTestQueue(db, events, reading.handlers);
  const [asset] = addAssets(db, ['video']).assets as [AssetId];
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
  await index();
  const runs = (stage: string) => reading.runs.get(`${stage} ${asset}`) ?? 0;
  return { db, world, reading, asset, index, runs };
}

const digests = (db: LibraryDatabase) =>
  db.driver.prepare('SELECT stage, output_digest AS d FROM asset_index_stages ORDER BY stage').all();
/** What migration 27 leaves on a library indexed before it. */
const forget = (db: LibraryDatabase) =>
  db.driver.prepare('UPDATE asset_index_stages SET output_digest = NULL').run();

describe('dependent invalidation on a library from before migration 27', () => {
  it('records the digests of what is stored on the first run and re-runs nothing', async () => {
    const t = await indexedLibrary();
    const recorded = digests(t.db);
    forget(t.db);
    await t.index();
    expect(digests(t.db)).toEqual(recorded);
    for (const stage of [
      'vision.shots',
      ...READERS,
      'vision.embedOcr',
      'audio.transcript',
      'vision.embedText',
    ])
      expect(t.runs(stage), stage).toBe(1);
  });

  it('a version rise compares with what the stage had stored: same shots re-run nothing, new shots their readers', async () => {
    const t = await indexedLibrary();
    forget(t.db);
    await t.index(risen(t.reading.stages, ['vision.shots']));
    for (const stage of READERS) expect(t.runs(stage), stage).toBe(1);

    forget(t.db);
    t.world.cuts = [60, 240];
    await t.index(risen(risen(t.reading.stages, ['vision.shots']), ['vision.shots']));
    for (const stage of READERS) expect(t.runs(stage), stage).toBe(2);
  });

  it('a stage that stores with no digest kept records one and resets nothing; the next change resets its readers', async () => {
    const t = await indexedLibrary();
    forget(t.db);
    const invalidation = createInvalidation({ db: t.db, stages: t.reading.stages });
    expect(invalidation.stored(t.asset, 'vision.shots')).toBe(0);
    expect(invalidation.stored(t.asset, 'vision.shots')).toBe(0);
    t.db.driver.prepare('DELETE FROM shots WHERE asset_id = ? AND index_in_asset = 1').run(t.asset);
    // Every row that reads vision.shots and applies to the asset goes back to waiting.
    expect(invalidation.stored(t.asset, 'vision.shots')).toBe(READERS.length);
    expect(invalidation.backfillSome()).toBeGreaterThan(0);
    expect(invalidation.backfillSome()).toBe(0);
    expect(invalidation.inputsKey(t.asset, 'library.hash')).toBe('');
    expect(invalidation.inputsKey(t.asset, 'vision.embed')).toMatch(/^:[0-9a-f]{16}$/);
  });
});

describe('checkStageReads', () => {
  const stage = (
    name: string,
    needs: string[],
    extra: Partial<IndexStageDefinition> = {},
  ): IndexStageDefinition => ({
    stage: name,
    version: 1,
    needs,
    appliesTo: ['video'],
    priority: 'normal',
    job: () => ({ skip: 'indexing.skip.none' }),
    result: () => ok({}),
    ...extra,
  });
  const stores = () => null;

  it('passes reads of stages waited for, directly or through a need, and reads nobody registered', () => {
    expect(() =>
      checkStageReads([
        stage('a.one', [], { stores }),
        stage('a.two', ['a.one'], { stores }),
        stage('a.three', ['a.two'], { reads: ['a.one', 'a.two', 'b.unregistered'] }),
      ]),
    ).not.toThrow();
  });

  it('throws on a read the stage does not wait for, and on a read stage that stores nothing', () => {
    expect(() =>
      checkStageReads([stage('a.one', [], { stores }), stage('a.two', [], { reads: ['a.one'] })]),
    ).toThrow(/reads 'a.one' without waiting/);
    expect(() =>
      checkStageReads([stage('a.one', []), stage('a.two', ['a.one'], { reads: ['a.one'] })]),
    ).toThrow(/'a.one' is read by 'a.two' but declares nothing/);
  });

  it('runs when the pipeline is built', () => {
    const db = openTestDb({ file: false });
    const events = createEventBus({ clock: systemClock });
    const stages = [stage('a.one', []), stage('a.two', ['a.one'], { reads: ['a.one'] })];
    expect(() =>
      createIndexingPipeline({ db, queue: createTestQueue(db, events, {}), events, stages }),
    ).toThrow(/declares nothing/);
  });
});
