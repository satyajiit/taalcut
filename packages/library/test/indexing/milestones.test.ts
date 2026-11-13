// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-R1: an asset's two finish lines through the pipeline. Searchable when its searchable stages are done or
 * skipped, complete when every stage is; each stored with the last of those finishes, announced once in
 * library.indexMilestone, reopened by a re-index or a version bump and announced again when reached.
 */
import {
  createEventBus,
  defineIndexStage,
  defineJobKind,
  err,
  NO_RETRY,
  ok,
  stageJob,
  ValidationError,
  type AssetId,
  type IndexMilestoneEvent,
  type IndexStageDefinition,
} from '@taalcut/core';
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { createIndexingPipeline, reindexAssets, type LibraryDatabase } from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline, type StubHandler } from './harness';
import { stubStages, type StubOptions } from './stages';

const DESCRIBE = defineJobKind({
  kind: 'test.describe',
  input: z.any(),
  output: z.any(),
  resource: 'cpu',
  retry: NO_RETRY,
});

/** The stub set with every stage searchable, plus descriptions, which count toward complete only. */
function stagesWithMilestones(stub: IndexStageDefinition[], embedVersion = 1): IndexStageDefinition[] {
  return [
    ...stub.map((stage) => ({
      ...stage,
      milestone: 'searchable' as const,
      ...(stage.stage === 'vision.embed' ? { version: embedVersion } : {}),
    })),
    defineIndexStage({
      stage: 'vision.describe',
      version: 1,
      needs: ['vision.embed'],
      appliesTo: ['video', 'image', 'live_photo'],
      priority: 'low',
      milestone: 'complete',
      job: (view) => stageJob(DESCRIBE, { assetId: view.assetId }),
      result: () => ok({}),
    }),
  ];
}

async function setup(options: StubOptions & { handlers?: Record<string, StubHandler> } = {}) {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const events = createEventBus({ clock: { now: clock.now } });
  const stub = stubStages(db, options);
  // Every job takes a second of the fake clock, so finishes differ.
  const handlers = Object.fromEntries(
    Object.entries({
      ...stub.handlers,
      [DESCRIBE.kind]: (() => ok({})) satisfies StubHandler,
      ...options.handlers,
    }).map(([kind, handler]): [string, StubHandler] => [
      kind,
      (input, jobId) => {
        clock.advance(1000);
        return handler(input, jobId);
      },
    ]),
  );
  const queue = createTestQueue(db, events, handlers);
  const seen: IndexMilestoneEvent[] = [];
  events.on('library.indexMilestone', ({ payload }) => void seen.push(payload));
  const start = async (stages = stagesWithMilestones(stub.stages)) => {
    const pipeline = createIndexingPipeline({ db, queue, events, stages, log: () => {} });
    await pipeline.start({ poll: false });
    return pipeline;
  };
  return { db, clock, queue, seen, start, stub };
}

const lines = (db: LibraryDatabase, assetId: AssetId) =>
  db.driver
    .prepare(
      'SELECT searchable_at AS searchable, complete_at AS complete FROM asset_index_state WHERE asset_id = ?',
    )
    .get(assetId) ?? { searchable: null, complete: null };

/** The last finish among the asset's rows (of these stages, or all). */
const lastFinish = (db: LibraryDatabase, assetId: AssetId, except?: string) =>
  db.driver
    .prepare(`SELECT MAX(finished_at) AS at FROM asset_index_stages WHERE asset_id = ? AND stage IS NOT ?`)
    .get(assetId, except ?? null)?.at;

const announced = (seen: readonly IndexMilestoneEvent[], milestone: string) =>
  seen.filter((event) => event.milestone === milestone).flatMap((event) => event.assetIds);

describe('index milestones in the pipeline', () => {
  it('stores searchable at the last searchable finish and complete at the last finish, each announced once', async () => {
    const t = await setup();
    const { assets } = addAssets(t.db, ['video', 'image', 'audio']);
    const [video, image, audio] = assets as [AssetId, AssetId, AssetId];
    const pipeline = await t.start();
    await runPipeline(pipeline, t.queue);

    for (const id of [video, image]) {
      expect(lines(t.db, id)).toEqual({
        searchable: lastFinish(t.db, id, 'vision.describe'),
        complete: lastFinish(t.db, id),
      });
      expect(lines(t.db, id).complete).toBeGreaterThan(Number(lines(t.db, id).searchable));
    }
    // Descriptions don't apply to audio: both lines are the same moment.
    expect(lines(t.db, audio)).toEqual({
      searchable: lastFinish(t.db, audio),
      complete: lastFinish(t.db, audio),
    });
    expect(announced(t.seen, 'searchable').sort()).toEqual([...assets].sort());
    expect(announced(t.seen, 'complete').sort()).toEqual([...assets].sort());
    // The video was announced searchable before its descriptions ran.
    const first = (milestone: string) =>
      t.seen.findIndex((event) => event.milestone === milestone && event.assetIds.includes(video));
    expect(first('searchable')).toBeLessThan(first('complete'));

    const status = pipeline.status();
    expect(status.overall).toMatchObject({ assets: 3, done: 3, searchable: 3 });
    expect(status.sources[0]?.stages.map((s) => [s.stage, s.milestone])).toEqual([
      ['library.hash', 'searchable'],
      ['media.normalise', 'searchable'],
      ['vision.shots', 'searchable'],
      ['vision.analyse', 'searchable'],
      ['audio.transcript', 'searchable'],
      ['vision.embed', 'searchable'],
      ['vision.describe', 'complete'],
    ]);
  });

  it('keeps an asset searchable when a complete-only stage fails, and not when a searchable one does', async () => {
    const failing = (code: string) => () => err(ValidationError({ field: code }));
    const described = await setup({ handlers: { [DESCRIBE.kind]: failing('describe') } });
    const [video] = addAssets(described.db, ['video']).assets as [AssetId];
    const pipeline = await described.start();
    await runPipeline(pipeline, described.queue);
    expect(lines(described.db, video)).toEqual({
      searchable: lastFinish(described.db, video, 'vision.describe'),
      complete: null,
    });
    expect(pipeline.status().overall).toMatchObject({ failed: 1, searchable: 1 });
    expect(announced(described.seen, 'complete')).toEqual([]);

    const transcribed = await setup({ handlers: { 'test.transcribe': failing('transcript') } });
    const both = addAssets(transcribed.db, ['video', 'image']).assets as [AssetId, AssetId];
    const second = await transcribed.start();
    await runPipeline(second, transcribed.queue);
    expect(lines(transcribed.db, both[0])).toEqual({ searchable: null, complete: null });
    // The image has no transcript stage: searchable and complete.
    expect(lines(transcribed.db, both[1]).complete).not.toBeNull();
    expect(announced(transcribed.seen, 'searchable')).toEqual([both[1]]);
  });

  it('counts a skipped searchable stage as done (a clip without sound)', async () => {
    const silent = new Set<AssetId>();
    const t = await setup({ silent });
    const [quiet] = addAssets(t.db, ['video']).assets as [AssetId];
    silent.add(quiet);
    const pipeline = await t.start();
    await runPipeline(pipeline, t.queue);
    expect(
      t.db.driver.prepare(`SELECT state FROM asset_index_stages WHERE stage = 'audio.transcript'`).get(),
    ).toEqual({
      state: 'skipped',
    });
    expect(lines(t.db, quiet)).toEqual({
      searchable: lastFinish(t.db, quiet, 'vision.describe'),
      complete: lastFinish(t.db, quiet),
    });
  });

  it('reopens the lines on a re-index, at once, and announces them again when reached', async () => {
    const t = await setup();
    const [video, image] = addAssets(t.db, ['video', 'image']).assets as [AssetId, AssetId];
    const pipeline = await t.start();
    await runPipeline(pipeline, t.queue);
    const before = lines(t.db, video);

    // Descriptions only: still searchable, not complete.
    expect(reindexAssets(t.db, [image], ['vision.describe']).ok).toBe(true);
    expect(lines(t.db, image)).toEqual({
      searchable: lastFinish(t.db, image, 'vision.describe'),
      complete: null,
    });
    // Everything after library.hash: neither, before the pipeline even looks.
    expect(reindexAssets(t.db, [video]).ok).toBe(true);
    expect(lines(t.db, video)).toEqual({ searchable: null, complete: null });
    expect(pipeline.status().overall.searchable).toBe(1);

    t.seen.length = 0;
    await runPipeline(pipeline, t.queue);
    expect(Number(lines(t.db, video).searchable)).toBeGreaterThan(Number(before.searchable));
    expect(announced(t.seen, 'searchable')).toEqual([video]);
    expect(announced(t.seen, 'complete').sort()).toEqual([video, image].sort());
  });

  it('reopens a stage’s line when its version rises, and announces it again', async () => {
    const t = await setup();
    const [video] = addAssets(t.db, ['video']).assets as [AssetId];
    const first = await t.start();
    await runPipeline(first, t.queue);
    first.stop();
    const before = lines(t.db, video);

    t.seen.length = 0;
    const bumped = await t.start(stagesWithMilestones(t.stub.stages, 2));
    // Starting again finds nothing new to say.
    expect(t.seen).toEqual([]);
    await runPipeline(bumped, t.queue);
    expect(Number(lines(t.db, video).searchable)).toBeGreaterThan(Number(before.searchable));
    expect(announced(t.seen, 'searchable')).toEqual([video]);
  });
});
