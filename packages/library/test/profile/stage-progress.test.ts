// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LIB1-PROG: what the clip page needs to say how far a clip's analysis has got: each stage's job, its saved progress
 * and start while it runs, and how long the stage takes on this Mac; what holds a waiting clip; and the held count,
 * so a clip that only waits for a model isn't counted as analysing.
 */
import { assetDetailSchema, indexingStatusSchema, newId, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { assetDetail, indexingStatus, indexState, type LibraryDatabase } from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets } from '../indexing/harness';

const NOW = Date.UTC(2026, 9, 29, 12);
const MODEL = 'library.stage.modelMissing';
const OFFLINE = 'library.stage.originalOffline';

function row(
  db: LibraryDatabase,
  assetId: AssetId,
  stage: string,
  state: string,
  extra: { started?: number; finished?: number; job?: string; reason?: string } = {},
) {
  db.driver
    .prepare(
      `INSERT INTO asset_index_stages (asset_id, stage, state, job_id, reason_key, started_at, finished_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      assetId,
      stage,
      state,
      extra.job ?? null,
      extra.reason ?? null,
      extra.started ?? null,
      extra.finished ?? null,
      NOW,
    );
}

function job(db: LibraryDatabase, id: string, progress: number | null) {
  db.driver
    .prepare(
      `INSERT INTO jobs (id, kind, state, resource_class, payload, progress, created_at, updated_at)
       VALUES (?, 'audio.transcribeAssetWhisper', 'running', 'cpu', '{}', ?, ?, ?)`,
    )
    .run(id, progress, NOW, NOW);
}

function library() {
  const clock = fakeClock(NOW);
  const db = openTestDb({ file: false, clock: clock.now });
  const { assets } = addAssets(db, ['video', 'video', 'video', 'video']);
  return { db, assets: assets as [AssetId, AssetId, AssetId, AssetId] };
}

describe('a stage’s progress in the clip’s detail', () => {
  it('gives a running stage its job, saved progress and start, and every stage its usual length here', () => {
    const { db, assets } = library();
    const [clip, other] = assets;
    const running = newId<'Job'>();
    const queued = newId<'Job'>();
    job(db, running, 0.42);
    // Earlier runs on this Mac: shots took 1 and 3 s (mean 2 s), the transcript 4 s.
    row(db, other, 'vision.shots', 'done', { started: NOW - 20_000, finished: NOW - 19_000 });
    row(db, clip, 'vision.shots', 'done', {
      started: NOW - 9_000,
      finished: NOW - 6_000,
      job: newId<'Job'>(),
    });
    row(db, other, 'audio.transcript', 'done', { started: NOW - 18_000, finished: NOW - 14_000 });
    row(db, clip, 'audio.transcript', 'running', { started: NOW - 1_500, job: running });
    row(db, clip, 'vision.describe', 'queued', { job: queued });
    row(db, clip, 'vision.embed', 'waiting');

    const detail = unwrap(assetDetail(db, clip));
    expect(assetDetailSchema.safeParse({ ...detail, waveform: null }).success).toBe(true);
    const by = (stage: string) => detail.stages.find((s) => s.stage === stage);
    // A done stage keeps no job: there is nothing left to follow.
    expect(by('vision.shots')).toEqual({ stage: 'vision.shots', state: 'done', typicalMs: 2_000 });
    expect(by('audio.transcript')).toMatchObject({
      state: 'running',
      jobId: running,
      progress: 0.42,
      startedAt: NOW - 1_500,
      typicalMs: 4_000,
    });
    expect(by('vision.describe')).toEqual({ stage: 'vision.describe', state: 'queued', jobId: queued });
    expect(by('vision.embed')).toEqual({ stage: 'vision.embed', state: 'waiting' });
  });

  it('leaves the progress out while the running job hasn’t saved any', () => {
    const { db, assets } = library();
    const running = newId<'Job'>();
    job(db, running, null);
    row(db, assets[0], 'vision.describe', 'running', { started: NOW - 500, job: running });
    const stage = unwrap(assetDetail(db, assets[0])).stages[0]!;
    expect(stage).toEqual({
      stage: 'vision.describe',
      state: 'running',
      jobId: running,
      startedAt: NOW - 500,
    });
  });
});

describe('what holds a waiting clip', () => {
  it('is its model or its original, the original first, and only while it waits', () => {
    expect(indexState({ total: 3, done: 1, failed: 0, active: 0, model: 1 }).held).toBe('model');
    expect(indexState({ total: 3, done: 1, failed: 0, active: 0, model: 1, original: 1 }).held).toBe(
      'original',
    );
    expect(indexState({ total: 3, done: 1, failed: 0, active: 0 })).not.toHaveProperty('held');
    // Running: something moves, whatever else waits.
    expect(indexState({ total: 3, done: 1, failed: 0, active: 1, model: 1 })).not.toHaveProperty('held');
  });

  it('reaches the clip’s summary and the indexing counts', () => {
    const { db, assets } = library();
    const [held, away, running, done] = assets;
    row(db, held, 'vision.shots', 'done', { started: NOW - 2_000, finished: NOW - 1_000 });
    row(db, held, 'vision.describe', 'waiting', { reason: MODEL });
    row(db, away, 'vision.shots', 'waiting', { reason: OFFLINE });
    row(db, running, 'vision.shots', 'running', { started: NOW - 100, job: newId<'Job'>() });
    row(db, running, 'vision.describe', 'waiting', { reason: MODEL });
    row(db, done, 'vision.shots', 'done', { started: NOW - 2_000, finished: NOW - 1_000 });

    expect(unwrap(assetDetail(db, held)).asset.index).toMatchObject({ state: 'waiting', held: 'model' });
    expect(unwrap(assetDetail(db, away)).asset.index).toMatchObject({ state: 'waiting', held: 'original' });
    expect(unwrap(assetDetail(db, running)).asset.index).not.toHaveProperty('held');

    const status = indexingStatus(db, { paused: false });
    expect(indexingStatusSchema.safeParse(status).success).toBe(true);
    expect(status.overall).toMatchObject({ assets: 4, done: 1, active: 1, waiting: 2, held: 2 });
    expect(status.sources[0]?.counts).toMatchObject({ waiting: 2, held: 2 });
  });
});
