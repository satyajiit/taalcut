// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB: core's SubjectSource over the track store and the `render.trackSubjects` job. A clip reads its own
 * track or a wider one it was trimmed inside; `ensure` queues only the ranges with no track, all at once, and
 * answers why a range has none.
 */
import { describe, expect, it } from 'vitest';
import {
  newId,
  ok,
  RationalTime,
  TimeRange,
  type AssetId,
  type JobRunOptions,
  type JobRunner,
  type SubjectTrack,
} from '@taalcut/core';
import { createSubjectSource } from '../../src/engine/subjects';
import { createSubjectTrackStore, type DerivedJsonFiles } from '../../src/reframe/subject-store';
import { RATE_30, sampleAt, samplesEvery, trackOf } from '../reframe/support';

const HASH = 'b'.repeat(64);
const at = (seconds: number) => RationalTime.fromSeconds(seconds, RATE_30);
const face = { x: 0.4, y: 0.2, width: 0.1, height: 0.1 };

function memoryFiles(): DerivedJsonFiles & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (key) => Promise.resolve(files.get(key) ?? null),
    write: (key, body) => {
      files.set(key, body);
      return Promise.resolve(ok(undefined));
    },
  };
}

function trackOver(assetId: AssetId, from: number, to: number): SubjectTrack {
  const samples = samplesEvery(4, to - from, () => ({ face })).map((sample) => ({
    ...sample,
    t: RationalTime.add(sample.t, at(from)),
    heads: [{ box: { x: 0.38, y: 0.12, width: 0.14, height: 0.2 }, confidence: 0.9 }],
  }));
  return {
    ...trackOf(samples, to - from, assetId),
    contentHash: HASH,
    range: TimeRange.of(at(from), at(to - from)),
    frame: { width: 1080, height: 1920 },
  };
}

function setup() {
  const assetId = newId<'Asset'>();
  const files = memoryFiles();
  const store = createSubjectTrackStore({ files, contentHashOf: async () => ok(HASH) });
  const runs: { input: { assetId: AssetId; range: TimeRange }; options: JobRunOptions | undefined }[] = [];
  const runner: Pick<JobRunner, 'run'> = {
    run: async (kind, input, options) => {
      const asked = input as { assetId: AssetId; range: TimeRange };
      runs.push({ input: asked, options });
      const from = RationalTime.toSeconds(asked.range.start);
      const put = await store.put(
        trackOver(asked.assetId, from, from + RationalTime.toSeconds(asked.range.duration)),
      );
      if (!put.ok) return put;
      return ok(kind.output.parse({ track: put.value }));
    },
  };
  const source = createSubjectSource({
    store,
    runner,
    asset: async (id) => ok(id === assetId ? { path: '/clips/a.mov', contentHash: HASH } : null),
  });
  return { assetId, store, runs, source, files };
}

describe('the subject source (FRM1-SUB)', () => {
  it('reads nothing before a track is made, and starts nothing', async () => {
    const { assetId, source, runs } = setup();
    expect(await source.over({ assetId, start: at(0), end: at(2) })).toEqual(ok(undefined));
    expect(runs).toEqual([]);
  });

  it('ensures each missing range once, then reads its samples with their heads and the frame', async () => {
    const { assetId, source, runs } = setup();
    const clip = { assetId, start: at(1), end: at(3) };
    expect(await source.ensure([clip, { ...clip }, clip])).toEqual(ok(undefined));
    expect(runs).toHaveLength(1);
    expect(runs[0]!.input.range).toEqual({ start: at(1), duration: at(2) });
    const span = await source.over(clip);
    expect(span.ok && span.value?.frame).toEqual({ width: 1080, height: 1920 });
    expect(span.ok && span.value?.detector).toBe('vision');
    expect(span.ok && span.value?.samples).toHaveLength(8);
    expect(span.ok && span.value?.samples[0]?.heads).toHaveLength(1);
    // Made already: nothing more is queued.
    expect(await source.ensure([clip])).toEqual(ok(undefined));
    expect(runs).toHaveLength(1);
  });

  it('reads a clip trimmed inside a tracked range from that track, only its own samples', async () => {
    const { assetId, source, runs } = setup();
    await source.ensure([{ assetId, start: at(0), end: at(4) }]);
    const trimmed = await source.over({ assetId, start: at(1.5), end: at(2.5) });
    // Samples sit on the asset's frames (30 fps): 1.75 s is frame 53.
    const times = trimmed.ok
      ? trimmed.value?.samples.map((sample) => Math.round(RationalTime.toSeconds(sample.t) * 4) / 4)
      : [];
    expect(times).toEqual([1.5, 1.75, 2, 2.25]);
    expect(await source.ensure([{ assetId, start: at(1.5), end: at(2.5) }])).toEqual(ok(undefined));
    expect(runs).toHaveLength(1);
    // Past the tracked end: a new track.
    expect(await source.over({ assetId, start: at(3), end: at(5) })).toEqual(ok(undefined));
  });

  it("doesn't read a track another recipe made", async () => {
    const { assetId, source, files } = setup();
    await source.ensure([{ assetId, start: at(0), end: at(2) }]);
    const other = createSubjectSource({
      store: createSubjectTrackStore({
        files,
        contentHashOf: async () => ok(HASH),
        recipe: { detector: 'onnx' },
      }),
      asset: async () => ok(null),
    });
    expect(await other.over({ assetId, start: at(0), end: at(2) })).toEqual(ok(undefined));
  });

  it('says why a range has none, and still makes the others', async () => {
    const { assetId, source, runs } = setup();
    const offline = newId<'Asset'>();
    const result = await source.ensure([
      { assetId: offline, start: at(0), end: at(1) },
      { assetId, start: at(0), end: at(1) },
    ]);
    expect(!result.ok && result.error.code).toBe('core.not_found');
    expect(runs).toHaveLength(1);
    const unqueued = createSubjectSource({
      store: createSubjectTrackStore({ files: memoryFiles(), contentHashOf: async () => ok(HASH) }),
      asset: async () => ok({ path: '/a.mov', contentHash: HASH }),
    });
    const none = await unqueued.ensure([{ assetId, start: at(0), end: at(1) }]);
    expect(!none.ok && none.error.code).toBe('core.not_found');
  });

  it('keeps every range in the index when tracks are put together', async () => {
    const { assetId, store } = setup();
    await Promise.all([store.put(trackOver(assetId, 0, 2)), store.put(trackOver(assetId, 5, 7))]);
    const first = await store.covering(assetId, at(0.5), at(1));
    const second = await store.covering(assetId, at(5.5), at(6));
    expect(first.ok && first.value?.range.start).toEqual(at(0));
    expect(second.ok && second.value?.range.start).toEqual(at(5));
    expect(sampleAt(0).heads).toBeUndefined();
  });
});
