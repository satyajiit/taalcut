// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Round IX, design C: the searchable and complete milestones on stages, statuses, assets and the event. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  assetDetailSchema,
  assetSummarySchema,
  cardSchema,
  checkIndexStageMilestones,
  createEventBus,
  createManualClock,
  DEFAULT_INDEX_MILESTONE,
  defineIndexStage,
  defineJobKind,
  EVENT_TYPES,
  INDEX_MILESTONES,
  indexCountsSchema,
  indexingStatusSchema,
  indexMilestoneEventSchema,
  indexMilestoneSchema,
  indexStageMilestone,
  importStatusSchema,
  newId,
  ok,
  stageJob,
  taalcutEventSchema,
  type IndexStageDefinition,
} from '@taalcut/core';

const T = 1_760_000_000_000;
const assetId = newId<'Asset'>();
const sourceId = newId<'Source'>();

const kind = defineJobKind({
  kind: 'vision.embedAsset',
  input: z.object({ path: z.string() }),
  output: z.null(),
  resource: 'gpu',
  lane: 'vision.embedder',
});
const stage: IndexStageDefinition = {
  stage: 'vision.embed',
  version: 2,
  needs: ['vision.shots'],
  appliesTo: ['video'],
  priority: 'normal',
  milestone: 'searchable',
  job: (view) => stageJob(kind, { path: view.path }),
  result: () => ok({}),
};

/** A status as a library from before round IX sent it, and as a stored importProgress card holds it. */
const oldCounts = { assets: 3, done: 1, active: 1, waiting: 0, failed: 1 };
const oldStatus = {
  sourceId,
  state: 'indexing',
  counts: oldCounts,
  stages: [{ stage: 'vision.embed', done: 1, left: 1, failed: 0 }],
  etaMs: 40_000,
  jobIds: [],
  updatedAt: T,
};

describe('milestones on stages', () => {
  it('has two finish lines; a stage without one counts toward complete', () => {
    expect(INDEX_MILESTONES).toEqual(['searchable', 'complete']);
    expect(indexMilestoneSchema.safeParse('ready').success).toBe(false);
    expect(DEFAULT_INDEX_MILESTONE).toBe('complete');
    expect(indexStageMilestone(stage)).toBe('searchable');
    expect(indexStageMilestone({ ...stage, milestone: undefined })).toBe('complete');
    expect(indexStageMilestone({})).toBe('complete');
  });

  it('defines a stage with a milestone and throws on an unknown one', () => {
    expect(defineIndexStage(stage)).toBe(stage);
    const { milestone: _milestone, ...unmarked } = stage;
    expect(defineIndexStage(unmarked)).toBe(unmarked);
    expect(() => defineIndexStage({ ...stage, milestone: 'ready' as never })).toThrow(/unknown milestone/);
  });

  it('lets a searchable stage need only searchable stages', () => {
    const s = (name: string, needs: string[], milestone?: 'searchable' | 'complete') => ({
      stage: name,
      needs,
      ...(milestone ? { milestone } : {}),
    });
    const good = [
      s('media.normalise', [], 'searchable'),
      s('vision.shots', ['media.normalise'], 'searchable'),
      s('vision.embed', ['vision.shots', 'audio.vad'], 'searchable'),
      s('media.proxy', ['media.normalise']),
      s('vision.describe', ['vision.embed', 'media.proxy'], 'complete'),
    ];
    expect(() => checkIndexStageMilestones(good)).not.toThrow();
    expect(() =>
      checkIndexStageMilestones([...good, s('vision.embedText', ['vision.describe'], 'searchable')]),
    ).toThrow(
      "Searchable index stage 'vision.embedText' needs 'vision.describe', which counts toward complete only.",
    );
    expect(() =>
      checkIndexStageMilestones([...good, s('audio.language', ['media.proxy'], 'searchable')]),
    ).toThrow(/'media.proxy'/);
  });
});

describe('milestones in the status', () => {
  it('counts searchable assets, and reads counts from before round IX', () => {
    expect(indexCountsSchema.parse(oldCounts)).toEqual(oldCounts);
    expect(indexCountsSchema.parse({ ...oldCounts, searchable: 2 }).searchable).toBe(2);
    expect(indexCountsSchema.safeParse({ ...oldCounts, searchable: -1 }).success).toBe(false);
    expect(indexCountsSchema.safeParse({ ...oldCounts, searchable: 1.5 }).success).toBe(false);
  });

  it('carries each stage’s milestone, and reads stages without one', () => {
    expect(importStatusSchema.parse(oldStatus)).toEqual(oldStatus);
    const marked = { ...oldStatus, stages: [{ ...oldStatus.stages[0], milestone: 'searchable' }] };
    expect(importStatusSchema.parse(marked).stages[0]?.milestone).toBe('searchable');
    const bad = { ...oldStatus, stages: [{ ...oldStatus.stages[0], milestone: 'ready' }] };
    expect(importStatusSchema.safeParse(bad).success).toBe(false);
    const overall = { ...oldCounts, searchable: 2 };
    const status = { paused: false, overall, sources: [marked], etaMs: null, updatedAt: T };
    expect(indexingStatusSchema.parse(status).overall.searchable).toBe(2);
  });

  it('still reads an importProgress card stored before round IX', () => {
    const card = {
      type: 'importProgress',
      id: 'import-1',
      version: 1,
      sourceId,
      status: oldStatus,
      thumbnails: [],
    };
    expect(cardSchema.parse(card)).toMatchObject({ status: { counts: oldCounts } });
  });
});

describe('searchableAt on the asset', () => {
  const asset = {
    id: assetId,
    kind: 'video',
    name: 'IMG_0418.MOV',
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
    shotCount: 3,
    language: 'en',
    index: { state: 'indexing', done: 6, total: 11 },
    thumbnail: null,
    reencode: null,
    trashed: false,
    provenance: { kind: 'captured' },
  };
  const at = (searchableAt: unknown) => ({ ...asset, index: { ...asset.index, searchableAt } });

  it('is absent before round IX, null until searchable, then the time', () => {
    expect(assetSummarySchema.parse(asset).index).toEqual(asset.index);
    expect(assetSummarySchema.parse(at(null)).index.searchableAt).toBeNull();
    expect(assetSummarySchema.parse(at(T + 90_000)).index.searchableAt).toBe(T + 90_000);
    for (const bad of [-1, 1.5, '2026-10-17'])
      expect(assetSummarySchema.safeParse(at(bad)).success).toBe(false);
  });

  it('shows each stage’s milestone in the asset detail', () => {
    const detail = {
      asset: at(T + 90_000),
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
      stages: [
        { stage: 'vision.embed', state: 'done', milestone: 'searchable' },
        { stage: 'media.proxy', state: 'running', milestone: 'complete' },
        { stage: 'vision.describe', state: 'waiting' },
      ],
    };
    expect(assetDetailSchema.parse(detail).stages.map((s) => s.milestone)).toEqual([
      'searchable',
      'complete',
      undefined,
    ]);
    const bad = { ...detail, stages: [{ stage: 'vision.embed', state: 'done', milestone: 'ready' }] };
    expect(assetDetailSchema.safeParse(bad).success).toBe(false);
  });
});

describe('the library.indexMilestone event', () => {
  it('is in the catalogue and crosses as a batch of assets', () => {
    expect(EVENT_TYPES).toContain('library.indexMilestone');
    const bus = createEventBus({ clock: createManualClock(T) });
    const seen: unknown[] = [];
    bus.onAny((event) => seen.push(taalcutEventSchema.parse(event)), ['library.indexMilestone']);
    bus.emit('library.indexMilestone', { milestone: 'searchable', assetIds: [assetId] });
    bus.emit('library.indexMilestone', { milestone: 'complete', assetIds: [assetId] });
    expect(seen).toEqual([
      { type: 'library.indexMilestone', at: T, payload: { milestone: 'searchable', assetIds: [assetId] } },
      { type: 'library.indexMilestone', at: T, payload: { milestone: 'complete', assetIds: [assetId] } },
    ]);
  });

  it('needs 1 to 1000 asset ids and a known milestone', () => {
    const ids = (n: number) => Array.from({ length: n }, () => newId<'Asset'>());
    expect(
      indexMilestoneEventSchema.safeParse({ milestone: 'searchable', assetIds: ids(1000) }).success,
    ).toBe(true);
    expect(
      indexMilestoneEventSchema.safeParse({ milestone: 'searchable', assetIds: ids(1001) }).success,
    ).toBe(false);
    expect(indexMilestoneEventSchema.safeParse({ milestone: 'searchable', assetIds: [] }).success).toBe(
      false,
    );
    expect(indexMilestoneEventSchema.safeParse({ milestone: 'ready', assetIds: ids(1) }).success).toBe(false);
    expect(indexMilestoneEventSchema.safeParse({ milestone: 'complete', assetIds: ['nope'] }).success).toBe(
      false,
    );
  });
});
