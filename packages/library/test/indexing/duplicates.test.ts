// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Near-duplicate grouping (G25) through the pipeline: once analyses settle
 * (debounced 30 s), one library-wide pass runs through the `duplicates`
 * definition and its groups replace the library's.
 */
import {
  createEventBus,
  defineJobKind,
  NO_RETRY,
  ok,
  stageJob,
  type DuplicateGroup,
  type DuplicatePassDefinition,
  type ShotId,
} from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  createIndexingPipeline,
  createRepositories,
  duplicatePassRequest,
  duplicateShotViews,
} from '../../src/index';
import { openTestDb } from '../helpers';
import { addAssets, createTestQueue, runPipeline } from './harness';
import { stubStages } from './stages';

const groupKind = defineJobKind({
  kind: 'test.groupDuplicates',
  input: z.object({ shots: z.array(z.object({ shotId: z.string(), dHash: z.string(), at: z.number() })) }),
  output: z.object({ groups: z.array(z.object({ shotIds: z.array(z.string()), bestShotId: z.string() })) }),
  resource: 'cpu',
  retry: NO_RETRY,
});

const duplicates: DuplicatePassDefinition = {
  after: ['vision.analyse'],
  job: (shots) =>
    stageJob(groupKind, {
      shots: shots.map((s) => ({ shotId: s.shotId, dHash: s.analysis.dHash, at: s.range.start.value })),
    }),
  groups: (output) => ok((output as { groups: DuplicateGroup[] }).groups),
};

/** Same dHash, same group; the last shot is the best take. */
function group(input: unknown) {
  const byHash = new Map<string, ShotId[]>();
  for (const shot of (input as z.output<typeof groupKind.input>).shots) {
    byHash.set(shot.dHash, [...(byHash.get(shot.dHash) ?? []), shot.shotId as ShotId]);
  }
  const groups = [...byHash.values()]
    .filter((ids) => ids.length > 1)
    .map((shotIds) => ({ shotIds, bestShotId: shotIds.at(-1)! }));
  return ok({ groups });
}

describe('near-duplicate pass', () => {
  afterEach(() => vi.useRealTimers());

  it('groups analysed shots 30 s after analyses settle', async () => {
    vi.useFakeTimers({ now: Date.UTC(2026, 9, 12) });
    const db = openTestDb({ file: false, clock: () => Date.now() });
    const events = createEventBus({ clock: { now: () => Date.now() } });
    const stub = stubStages(db);
    const queue = createTestQueue(db, events, { ...stub.handlers, [groupKind.kind]: group });
    const pipeline = createIndexingPipeline({
      db,
      queue,
      events,
      stages: stub.stages,
      duplicates,
      log: () => {},
    });
    await pipeline.start({ poll: false });
    const { assets } = addAssets(db, ['video', 'video', 'video']);
    await runPipeline(pipeline, queue);
    const repos = createRepositories(db);
    const shots = () => assets.flatMap((id) => repos.shots.listByAsset(id));
    expect(shots().every((s) => s.duplicateGroup === null)).toBe(true);

    await vi.advanceTimersByTimeAsync(29_000);
    expect(await queue.runNext()).toBeNull(); // still debouncing
    await vi.advanceTimersByTimeAsync(1_000);
    await pipeline.idle();
    expect(await queue.runNext()).toBe(groupKind.kind);
    await pipeline.idle();

    // The stub analyses give every asset's first shot one dHash and every second shot another.
    const firsts = shots().filter((s) => s.indexInAsset === 0);
    const seconds = shots().filter((s) => s.indexInAsset === 1);
    expect(new Set(firsts.map((s) => s.duplicateGroup)).size).toBe(1);
    expect(firsts.filter((s) => s.bestTake)).toHaveLength(1);
    expect(firsts.find((s) => s.bestTake)?.id).toBe(firsts[0]!.duplicateGroup);
    expect(seconds.filter((s) => s.bestTake)).toHaveLength(1);
    pipeline.stop();
  });

  it('skips a pass with nothing to compare, and keys a pass by what it sees', () => {
    const db = openTestDb({ file: false });
    expect(duplicatePassRequest(duplicates, duplicateShotViews(db))).toEqual({ ok: true, value: null });
  });
});
