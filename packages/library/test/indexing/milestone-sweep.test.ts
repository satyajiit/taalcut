// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-R1: the milestone sweep on its own (the backfill on open, other processes' writes, batched events) and the
 * stage registry that lets a process without the stage definitions show each stage's milestone.
 */
import {
  createEventBus,
  defineIndexStage,
  ok,
  type AssetId,
  type AssetKind,
  type IndexMilestone,
  type IndexMilestoneEvent,
  type IndexStageDefinition,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  assetDetail,
  browseAssets,
  createIndexingPipeline,
  createMilestoneTracker,
  readImportStatus,
  registerIndexStages,
  type LibraryDatabase,
} from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets, createTestQueue } from './harness';

const NOW = Date.UTC(2026, 9, 17, 9);

function stage(
  name: string,
  needs: string[],
  milestone: IndexMilestone,
  appliesTo: AssetKind[] = ['video', 'image'],
): IndexStageDefinition {
  return defineIndexStage({
    stage: name,
    version: 1,
    needs,
    appliesTo,
    priority: milestone === 'searchable' ? 'normal' : 'low',
    milestone,
    job: () => ({ skip: 'test.never' }),
    result: () => ok({}),
  });
}

const STAGES = [
  stage('library.hash', [], 'searchable'),
  stage('vision.embed', ['library.hash'], 'searchable'),
  stage('vision.describe', ['vision.embed'], 'complete', ['video']),
];

function setup() {
  const clock = fakeClock(NOW);
  const db = openTestDb({ file: false, clock: clock.now });
  const events = createEventBus({ clock: { now: clock.now } });
  const seen: IndexMilestoneEvent[] = [];
  events.on('library.indexMilestone', ({ payload }) => void seen.push(payload));
  return { db, clock, events, seen };
}

function row(db: LibraryDatabase, assetId: AssetId, stage: string, state: string, finished: number | null) {
  db.driver
    .prepare(
      `INSERT OR REPLACE INTO asset_index_stages (asset_id, stage, state, finished_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(assetId, stage, state, finished, db.clock());
}

const lines = (db: LibraryDatabase, assetId: AssetId) =>
  db.driver
    .prepare(
      'SELECT searchable_at AS searchable, complete_at AS complete FROM asset_index_state WHERE asset_id = ?',
    )
    .get(assetId) ?? { searchable: null, complete: null };

describe('milestone sweep', () => {
  it('backfills assets indexed before it ran, silently, and leaves a missing stage open', () => {
    const t = setup();
    const [done, partial, unseeded] = addAssets(t.db, ['video', 'video', 'image']).assets as [
      AssetId,
      AssetId,
      AssetId,
    ];
    row(t.db, done, 'library.hash', 'done', NOW - 9_000);
    row(t.db, done, 'vision.embed', 'done', NOW - 5_000);
    row(t.db, done, 'vision.describe', 'skipped', NOW - 2_000);
    row(t.db, partial, 'library.hash', 'done', NOW - 8_000);
    row(t.db, partial, 'vision.embed', 'skipped', NOW - 6_000);
    row(t.db, partial, 'vision.describe', 'waiting', null);
    // Only the hash row exists (the import wrote it; the pipeline hasn't seeded the rest).
    row(t.db, unseeded, 'library.hash', 'done', NOW - 1_000);

    const tracker = createMilestoneTracker({ db: t.db, events: t.events, stages: STAGES });
    const swept = tracker.sweep();
    expect(swept.ok && swept.value.reached.searchable.length).toBe(2);
    expect(lines(t.db, done)).toEqual({ searchable: NOW - 5_000, complete: NOW - 2_000 });
    expect(lines(t.db, partial)).toEqual({ searchable: NOW - 6_000, complete: null });
    expect(lines(t.db, unseeded)).toEqual({ searchable: null, complete: null });
    expect(t.seen).toEqual([]);
  });

  it('picks up rows another process changed since the last sweep, and announces arrivals once', () => {
    const t = setup();
    const [video] = addAssets(t.db, ['video']).assets as [AssetId];
    row(t.db, video, 'library.hash', 'done', NOW - 1_000);
    row(t.db, video, 'vision.embed', 'running', null);
    row(t.db, video, 'vision.describe', 'waiting', null);
    const tracker = createMilestoneTracker({ db: t.db, events: t.events, stages: STAGES });
    tracker.sweep();

    t.clock.advance(60_000);
    row(t.db, video, 'vision.embed', 'done', NOW + 59_000);
    expect(tracker.sweep()).toEqual({
      ok: true,
      value: { reached: { searchable: [video], complete: [] }, cleared: 0 },
    });
    // Nothing new: nothing said again.
    tracker.sweep();
    t.clock.advance(60_000);
    row(t.db, video, 'vision.describe', 'done', NOW + 119_000);
    tracker.sweep();
    expect(t.seen).toEqual([
      { milestone: 'searchable', assetIds: [video] },
      { milestone: 'complete', assetIds: [video] },
    ]);

    // Another process puts embedding back (its own reset path): the line closes, silently.
    t.clock.advance(1_000);
    row(t.db, video, 'vision.embed', 'waiting', null);
    expect(tracker.sweep()).toMatchObject({ ok: true, value: { cleared: 1 } });
    expect(lines(t.db, video)).toEqual({ searchable: null, complete: null });
    expect(t.seen).toHaveLength(2);
  });

  it('after a restart, says nothing again, and the status and clip pages already show the stored lines', () => {
    const t = setup();
    const [video] = addAssets(t.db, ['video']).assets as [AssetId];
    row(t.db, video, 'library.hash', 'done', NOW - 1_000);
    row(t.db, video, 'vision.embed', 'running', null);
    row(t.db, video, 'vision.describe', 'waiting', null);
    expect(registerIndexStages(t.db, STAGES).ok).toBe(true);
    const before = createMilestoneTracker({ db: t.db, events: t.events, stages: STAGES });
    before.sweep();
    t.clock.advance(1_000);
    row(t.db, video, 'vision.embed', 'done', NOW + 500);
    before.sweep();
    expect(t.seen).toEqual([{ milestone: 'searchable', assetIds: [video] }]);

    // The jobs process starts again: its first sweep is the silent backfill, and nothing changed.
    t.clock.advance(60_000);
    const after = createMilestoneTracker({ db: t.db, events: t.events, stages: STAGES });
    expect(after.sweep()).toEqual({
      ok: true,
      value: { reached: { searchable: [], complete: [] }, cleared: 0 },
    });
    expect(t.seen).toHaveLength(1);
    // What the renderer reads when it opens (library.indexing.status, library.browse): the stored line, no event needed.
    expect(readImportStatus(t.db).overall.searchable).toBe(1);
    const page = browseAssets(t.db);
    expect(page.ok && page.value.items.map((item) => item.index.searchableAt)).toEqual([NOW + 500]);
  });

  it('sends at most 1000 assets per event', () => {
    const t = setup();
    const { assets } = addAssets(
      t.db,
      Array.from({ length: 1001 }, (): AssetKind => 'image'),
    );
    const tracker = createMilestoneTracker({ db: t.db, events: t.events, stages: STAGES.slice(0, 2) });
    tracker.sweep();
    t.clock.advance(1_000);
    for (const id of assets) {
      row(t.db, id, 'library.hash', 'done', NOW);
      row(t.db, id, 'vision.embed', 'done', NOW + 500);
    }
    tracker.sweep();
    expect(t.seen.map((event) => [event.milestone, event.assetIds.length])).toEqual([
      ['searchable', 1000],
      ['searchable', 1],
      ['complete', 1000],
      ['complete', 1],
    ]);
  });

  it('refuses a searchable stage that needs a complete-only one', () => {
    const t = setup();
    const queue = createTestQueue(t.db, t.events, {});
    const stages = [
      stage('library.hash', [], 'complete'),
      stage('vision.embed', ['library.hash'], 'searchable'),
    ];
    expect(() => createIndexingPipeline({ db: t.db, queue, events: t.events, stages })).toThrow(
      "Searchable index stage 'vision.embed' needs 'library.hash', which counts toward complete only.",
    );
  });
});

describe('stage registry', () => {
  it('gives a process without the definitions each stage’s milestone and the pipeline order', async () => {
    const t = setup();
    const [video] = addAssets(t.db, ['video']).assets as [AssetId];
    row(t.db, video, 'vision.describe', 'waiting', null);
    row(t.db, video, 'library.hash', 'done', NOW);
    row(t.db, video, 'vision.embed', 'running', null);
    row(t.db, video, 'test.unregistered', 'waiting', null);

    // Before any pipeline ran: the SPEC's order and no milestones.
    const before = readImportStatus(t.db).sources[0];
    expect(before?.stages.some((s) => 'milestone' in s)).toBe(false);

    expect(registerIndexStages(t.db, STAGES).ok).toBe(true);
    const after = readImportStatus(t.db).sources[0];
    expect(after?.stages.map((s) => [s.stage, s.milestone])).toEqual([
      ['library.hash', 'searchable'],
      ['vision.embed', 'searchable'],
      ['vision.describe', 'complete'],
      ['test.unregistered', undefined],
    ]);
    // The clip page's detail lists them in the same pipeline order (UX2), the unknown stage last.
    const detail = assetDetail(t.db, video);
    expect(detail.ok && detail.value.stages.map((s) => [s.stage, s.milestone])).toEqual([
      ['library.hash', 'searchable'],
      ['vision.embed', 'searchable'],
      ['vision.describe', 'complete'],
      ['test.unregistered', undefined],
    ]);
    // Registering again replaces the list.
    expect(registerIndexStages(t.db, STAGES.slice(0, 1)).ok).toBe(true);
    expect(readImportStatus(t.db).sources[0]?.stages[0]).toMatchObject({ stage: 'library.hash' });
    expect(t.db.driver.prepare('SELECT COUNT(*) AS n FROM index_stages').get()).toEqual({ n: 1 });
  });
});
