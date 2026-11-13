// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The export's subject track source (P3-V2, round P3-3): a missing shot goes to the `render.trackSubjects` job
 * with the export's job as its parent, and the track it kept is read back from the store.
 */
import { describe, expect, it } from 'vitest';
import {
  err,
  newId,
  ok,
  RationalTime,
  ValidationError,
  type AssetId,
  type JobRunOptions,
  type JobRunner,
  type SubjectTrack,
} from '@taalcut/core';
import { createSubjectTrackSource, type SubjectSourceDeps } from '../../src/engine/subject-source';
import { RATE_30, sampleAt, trackOf } from '../reframe/support';

const range = { start: RationalTime.zero(RATE_30), duration: RationalTime.fromSeconds(2, RATE_30) };

function setup(overrides: Partial<SubjectSourceDeps> = {}) {
  const assetId = newId<'Asset'>();
  const track: SubjectTrack = trackOf([sampleAt(0), sampleAt(1)], 2, assetId);
  const stored: SubjectTrack[] = [];
  const runs: { kind: string; input: unknown; options: JobRunOptions | undefined }[] = [];
  const runner: Pick<JobRunner, 'run'> = {
    run: async (kind, input, options) => {
      runs.push({ kind: kind.kind, input, options });
      // The jobs process tracks the shot and keeps it in the shared media cache.
      stored.push(track);
      return ok(kind.output.parse({ track: REF }));
    },
  };
  const deps: SubjectSourceDeps = {
    store: { get: async () => ok(stored[0] ?? null) },
    runner,
    asset: async (id: AssetId) =>
      ok(id === assetId ? { path: '/clips/a.mov', contentHash: 'ab'.repeat(32) } : null),
    ...overrides,
  };
  return { assetId, track, runs, source: createSubjectTrackSource(deps) };
}

const REF = {
  kind: 'subjectTrack',
  key: `subjects/ab/${'ab'.repeat(32)}.v1.json`,
  bytes: 10,
  mimeType: 'application/json',
  recipe: 1,
};

describe('the export subject track source (P3-V2)', () => {
  it("reads the store, and tracks a missing shot through the queue as the export job's child", async () => {
    const { assetId, track, runs, source } = setup();
    expect(await source.get(assetId, range)).toEqual(ok(null));
    const parentJobId = newId<'Job'>();
    const signal = new AbortController().signal;
    expect(await source.track(assetId, range, signal, { parentJobId })).toEqual(ok(track));
    expect(runs).toEqual([
      { kind: 'render.trackSubjects', input: { assetId, range }, options: { signal, parentJobId } },
    ]);
    expect(await source.get(assetId, range)).toEqual(ok(track));
  });

  it('queues nothing without a runner or for an offline asset', async () => {
    const unqueued = createSubjectTrackSource({
      store: { get: async () => ok(null) },
      asset: async () => ok({ path: '/clips/a.mov', contentHash: 'ab'.repeat(32) }),
    });
    expect(await unqueued.track(newId<'Asset'>(), range)).toEqual(ok(null));
    const offline = setup();
    expect(await offline.source.track(newId<'Asset'>(), range)).toEqual(ok(null));
    expect(offline.runs).toEqual([]);
  });

  it('returns a failed job as the error (the export then centre-crops with a warning)', async () => {
    const failing = setup({
      runner: { run: async () => err(ValidationError({ field: 'track' })) },
    });
    const result = await failing.source.track(failing.assetId, range);
    expect(result.ok ? null : result.error.code).toBe('core.validation');
  });
});
