// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** LIB1-PROG: a stage's job, saved progress, start and usual length; what holds a waiting asset; the held count. */
import { describe, expect, it } from 'vitest';
import {
  ASSET_HOLDS,
  assetDetailSchema,
  assetSummarySchema,
  indexCountsSchema,
  indexingStatusSchema,
  newId,
} from '@taalcut/core';

const T = 1_760_000_000_000;
const sourceId = newId<'Source'>();
const jobId = newId<'Job'>();

const asset = {
  id: newId<'Asset'>(),
  kind: 'video',
  name: 'IMG_0001.MOV',
  capturedAt: T,
  addedAt: T + 1,
  duration: null,
  width: 1080,
  height: 1920,
  orientation: 'portrait',
  availability: 'online',
  sourceIds: [sourceId],
  description: null,
  quality: null,
  shotCount: 1,
  language: null,
  index: { state: 'waiting', done: 8, total: 15, searchableAt: null },
  thumbnail: null,
  reencode: null,
  trashed: false,
  provenance: { kind: 'captured' },
};

const detail = (stages: unknown[]) => ({
  asset,
  facts: null,
  shots: [],
  transcript: null,
  locations: [],
  reencodeReasons: [],
  playback: null,
  filmstrip: null,
  waveform: null,
  beats: null,
  sizeBytes: 1000,
  stages,
});

describe('a stage’s progress in the asset detail', () => {
  it('carries the job, its saved progress, when it started and how long it usually takes', () => {
    const parsed = assetDetailSchema.parse(
      detail([
        { stage: 'vision.shots', state: 'done', typicalMs: 1259 },
        { stage: 'audio.transcript', state: 'running', jobId, progress: 0.4, startedAt: T, typicalMs: 3377 },
        { stage: 'vision.describe', state: 'queued', jobId },
      ]),
    );
    expect(parsed.stages[1]).toMatchObject({ jobId, progress: 0.4, startedAt: T, typicalMs: 3377 });
    expect(parsed.stages[2]).toEqual({ stage: 'vision.describe', state: 'queued', jobId });
  });

  it('parses a row from before LIB1 unchanged, and refuses a bad value', () => {
    const old = { stage: 'vision.embed', state: 'waiting' };
    expect(assetDetailSchema.parse(detail([old])).stages[0]).toEqual(old);
    for (const bad of [
      { ...old, progress: 1.5 },
      { ...old, progress: -0.1 },
      { ...old, startedAt: 1.5 },
      { ...old, typicalMs: -1 },
      { ...old, jobId: 'not a job' },
    ])
      expect(assetDetailSchema.safeParse(detail([bad])).success).toBe(false);
  });
});

describe('what holds a waiting asset', () => {
  it('is a model or the original, absent while nothing holds it', () => {
    expect(ASSET_HOLDS).toEqual(['model', 'original']);
    expect(assetSummarySchema.parse(asset).index.held).toBeUndefined();
    for (const held of ASSET_HOLDS)
      expect(assetSummarySchema.parse({ ...asset, index: { ...asset.index, held } }).index.held).toBe(held);
    expect(assetSummarySchema.safeParse({ ...asset, index: { ...asset.index, held: 'drive' } }).success).toBe(
      false,
    );
  });

  it('counts held assets apart, and a status without the count still parses', () => {
    const counts = { assets: 5, done: 2, active: 1, waiting: 2, failed: 0, searchable: 3 };
    expect(indexCountsSchema.parse(counts).held).toBeUndefined();
    expect(indexCountsSchema.parse({ ...counts, held: 2 }).held).toBe(2);
    expect(indexCountsSchema.safeParse({ ...counts, held: -1 }).success).toBe(false);
    const status = { paused: false, overall: { ...counts, held: 1 }, sources: [], etaMs: null, updatedAt: T };
    expect(indexingStatusSchema.parse(status).overall.held).toBe(1);
  });
});
