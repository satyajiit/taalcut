// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** P2-L13 status: counts per source and overall, stages in pipeline order, ETA, and the throttled event. */
import {
  createEventBus,
  indexingStatusSchema,
  newId,
  unwrap,
  type AssetId,
  type IndexingStatus,
  type SourceId,
} from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createIndexingPipeline,
  createRepositories,
  INDEXING_PAUSED_SETTING,
  indexingStatus,
  readImportStatus,
  type LibraryDatabase,
} from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { stubStages } from './stages';

const NOW = Date.UTC(2026, 9, 12, 12);
const JOB = newId<'Job'>();

function row(
  db: LibraryDatabase,
  assetId: AssetId,
  stage: string,
  state: string,
  times: { started?: number; finished?: number; job?: string } = {},
) {
  db.driver
    .prepare(
      `INSERT INTO asset_index_stages (asset_id, stage, state, job_id, started_at, finished_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(assetId, stage, state, times.job ?? null, times.started ?? null, times.finished ?? null, NOW);
}

function library() {
  const clock = fakeClock(NOW);
  const db = openTestDb({ file: false, clock: clock.now });
  const trip = addAssets(db, ['video', 'video', 'video'], { sourceName: 'Trip' });
  const old = addAssets(db, ['image'], { sourceName: 'Old' });
  const phone = addAssets(db, ['video'], { sourceName: 'iPhone' });
  db.driver.prepare(`UPDATE sources SET kind = 'wifi_import' WHERE id = ?`).run(phone.sourceId);
  db.driver
    .prepare(`UPDATE asset_locations SET first_seen_at = ? WHERE source_id = ?`)
    .run(NOW - 5_000, phone.sourceId);
  const [a1, a2, a3] = trip.assets as [AssetId, AssetId, AssetId];
  row(db, a1, 'library.hash', 'done', { started: NOW - 10_000, finished: NOW - 9_000 });
  row(db, a1, 'media.normalise', 'done', { started: NOW - 9_000, finished: NOW - 7_000 });
  row(db, a2, 'library.hash', 'done', { started: NOW - 8_000, finished: NOW - 7_000 });
  row(db, a2, 'media.normalise', 'running', { started: NOW - 1_000, job: JOB });
  row(db, a3, 'library.hash', 'failed', { finished: NOW - 500 });
  row(db, old.assets[0]!, 'library.hash', 'done', {
    started: NOW - 3 * 3_600_000,
    finished: NOW - 3 * 3_600_000 + 1_000,
  });
  row(db, phone.assets[0]!, 'library.hash', 'waiting');
  // a1 reached its searchable stages (the pipeline's sweep stores this; milestones.test.ts).
  db.driver
    .prepare('INSERT INTO asset_index_state (asset_id, searchable_at) VALUES (?, ?)')
    .run(a1, NOW - 7_000);
  return { db, trip: trip.sourceId, old: old.sourceId, phone: phone.sourceId };
}

const byId = (status: IndexingStatus, id: SourceId) => status.sources.find((s) => s.sourceId === id);

describe('indexing status', () => {
  it('counts each asset once, per source and overall, with stages in pipeline order and an ETA', () => {
    const t = library();
    const status = indexingStatus(t.db, { paused: false, order: ['library.hash', 'media.normalise'] });
    expect(indexingStatusSchema.safeParse(status).success).toBe(true);
    expect(status.overall).toEqual({
      assets: 5,
      done: 2,
      active: 1,
      waiting: 1,
      failed: 1,
      searchable: 1,
      held: 0,
    });
    // hash: mean of 1000, 1000, 1000 ms; normalise: 2000 ms. Left: one normalise, one hash.
    expect(status.etaMs).toBe(3_000);
    const trip = byId(status, t.trip)!;
    expect(trip).toMatchObject({
      state: 'indexing',
      counts: { assets: 3, done: 1, active: 1, waiting: 0, failed: 1, searchable: 1 },
      stages: [
        { stage: 'library.hash', done: 2, left: 0, failed: 1 },
        { stage: 'media.normalise', done: 1, left: 1, failed: 0 },
      ],
      etaMs: 2_000,
      jobIds: [JOB],
    });
    expect(byId(status, t.phone)).toMatchObject({ state: 'receiving', etaMs: 1_000 });
    // Nothing done in the last hour and nothing left: idle, left out.
    expect(byId(status, t.old)).toBeUndefined();
  });

  it('says paused while work is left, and includes an idle source when asked about it', () => {
    const t = library();
    expect(readImportStatus(t.db).paused).toBe(false);
    unwrap(createRepositories(t.db).settings.set(INDEXING_PAUSED_SETTING.key, true));
    const status = readImportStatus(t.db, { sourceId: t.old });
    expect(status.paused).toBe(true);
    expect(byId(status, t.trip)?.state).toBe('paused');
    expect(byId(status, t.old)).toMatchObject({ state: 'done', etaMs: 0 });
  });
});

describe('the library.indexing event', () => {
  afterEach(() => vi.useRealTimers());

  it('goes out on change only, at most twice a second', async () => {
    vi.useFakeTimers({ now: NOW });
    const db = openTestDb({ file: false, clock: () => Date.now() });
    const events = createEventBus({ clock: { now: () => Date.now() } });
    const sent: IndexingStatus[] = [];
    events.on('library.indexing', (event) => sent.push(event.payload));
    const stub = stubStages(db);
    const queue = createTestQueue(db, events, stub.handlers);
    const pipeline = createIndexingPipeline({ db, queue, events, stages: stub.stages, log: () => {} });
    await pipeline.start({ poll: false });
    expect(sent).toHaveLength(1); // the first status
    await pipeline.tick();
    expect(sent).toHaveLength(1); // unchanged: nothing sent
    addAssets(db, ['image']);
    await pipeline.tick();
    expect(sent).toHaveLength(1); // changed, but within 500 ms of the last one
    await vi.advanceTimersByTimeAsync(500);
    await pipeline.idle();
    expect(sent).toHaveLength(2);
    expect(sent[1]!.overall.assets).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000);
    await pipeline.tick();
    expect(sent).toHaveLength(2);
    pipeline.stop();
  });

  it('is followed by library.changed for the assets whose results were stored, at most once a second', async () => {
    vi.useFakeTimers({ now: NOW });
    const db = openTestDb({ file: false, clock: () => Date.now() });
    const events = createEventBus({ clock: { now: () => Date.now() } });
    const changed: string[][] = [];
    events.on('library.changed', (event) => {
      expect(event.payload).toMatchObject({ projectId: null, entity: 'asset', change: 'updated' });
      changed.push([...event.payload.ids].sort());
    });
    const stub = stubStages(db);
    const queue = createTestQueue(db, events, stub.handlers);
    const pipeline = createIndexingPipeline({ db, queue, events, stages: stub.stages, log: () => {} });
    await pipeline.start({ poll: false });
    const { assets } = addAssets(db, ['image', 'video']);
    await runPipeline(pipeline, queue);
    expect(changed).toHaveLength(0); // batched: nothing until the gap has passed
    await vi.advanceTimersByTimeAsync(1_000);
    expect(changed).toEqual([[...assets].sort()]); // one event, each asset once
    await vi.advanceTimersByTimeAsync(5_000);
    expect(changed).toHaveLength(1);
    pipeline.stop();
  });
});
