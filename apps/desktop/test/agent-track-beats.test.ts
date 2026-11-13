// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-B1 leftover: timeline's `trackBeats` (music path b) reads the beat map stored on the asset row before it
 * runs audio's tracker, and stores what a tracking run found, so the same song is tracked once. Real library
 * repositories on an in-memory database; the job runner is a recording fake.
 */
import {
  beatMapSchema,
  defineError,
  err,
  newId,
  ok,
  unwrap,
  type AssetId,
  type BeatMap,
  type JobRunner,
} from '@taalcut/core';
import { createRepositories, openDatabase, type Repositories } from '@taalcut/library';
import { describe, expect, it } from 'vitest';
import { storedBeatTracker } from '../src/utility/roots/agent-track-beats';

const RATE = { num: 50, den: 1 };

function beatMap(bpm: number): BeatMap {
  return beatMapSchema.parse({
    rate: RATE,
    beats: [0, 25, 50, 75].map((value) => ({ value, rate: RATE })),
    downbeats: [0],
    bpm,
    beatsPerBar: 4,
    confidence: 0.9,
    source: 'tracker',
  });
}

interface RecordedRun {
  readonly kind: string;
  readonly input: unknown;
}

const JobFailed = defineError('test.job_failed');

/** The tracker's whole output for a map; the fake parses it with the job kind's own output schema. */
function tracked(map: BeatMap) {
  return {
    beatMap: map,
    downbeatSource: 'model',
    flags: [],
    envelope: { rate: RATE, peaks: [0.5] },
    model: 'beat-this',
  };
}

/** A job runner that records each run and answers with `answer` (an output) or fails. */
function recordingJobs(answer: ReturnType<typeof tracked> | 'fail') {
  const runs: RecordedRun[] = [];
  const jobs: Pick<JobRunner, 'run'> = {
    run: async (kind, input) => {
      runs.push({ kind: kind.kind, input });
      return answer === 'fail' ? err(JobFailed()) : ok(kind.output.parse(answer));
    },
  };
  return { jobs, runs };
}

function library(): { repos: Repositories; song: AssetId } {
  const db = unwrap(openDatabase({ path: ':memory:' }));
  const repos = createRepositories(db);
  const source = unwrap(
    repos.sources.add({ kind: 'watched_folder', displayName: 'Music', rootPath: '/Users/me/Music' }),
  );
  const song = unwrap(repos.assets.create({ kind: 'audio', sizeBytes: 1000, originalFilename: 'song.m4a' }));
  unwrap(
    repos.assetLocations.add({
      assetId: song.id,
      sourceId: source.id,
      storage: 'referenced',
      relativePath: 'song.m4a',
      absolutePathCached: '/Users/me/Music/song.m4a',
      sizeBytes: 1000,
      state: 'present',
    }),
  );
  return { repos, song: song.id };
}

function tracker(repos: Repositories, jobs: Pick<JobRunner, 'run'>) {
  return storedBeatTracker({
    assets: () => repos.assets,
    locations: () => repos.assetLocations,
    jobs: () => jobs,
  });
}

describe('trackBeats for the user’s own track', () => {
  it('reads the stored beat map and never runs the tracker', async () => {
    const { repos, song } = library();
    unwrap(repos.assets.setBeatMap(song, beatMap(120)));
    const { jobs, runs } = recordingJobs(tracked(beatMap(90)));
    const found = unwrap(await tracker(repos, jobs)(song));
    expect(found?.bpm).toBe(120);
    expect(runs).toEqual([]);
  });

  it('tracks a song once, stores the map, and reads it the next time', async () => {
    const { repos, song } = library();
    const { jobs, runs } = recordingJobs(tracked(beatMap(96)));
    const trackBeats = tracker(repos, jobs);
    expect(unwrap(await trackBeats(song))?.bpm).toBe(96);
    expect(runs).toEqual([{ kind: 'audio.trackBeats', input: { path: '/Users/me/Music/song.m4a' } }]);
    expect(repos.assets.beatMap(unwrap(repos.assets.get(song)))?.bpm).toBe(96);
    expect(unwrap(await trackBeats(song))?.bpm).toBe(96);
    expect(runs).toHaveLength(1);
  });

  it('passes a failed tracking run on and stores nothing', async () => {
    const { repos, song } = library();
    const { jobs, runs } = recordingJobs('fail');
    const failed = await tracker(repos, jobs)(song);
    expect(failed.ok ? null : failed.error.code).toBe('test.job_failed');
    expect(runs).toHaveLength(1);
    expect(repos.assets.beatMap(unwrap(repos.assets.get(song)))).toBeNull();
  });

  it('is core.not_found for an asset with no file on this Mac', async () => {
    const { repos } = library();
    const { jobs, runs } = recordingJobs(tracked(beatMap(120)));
    const missing = await tracker(repos, jobs)(newId<'Asset'>());
    expect(missing.ok ? null : missing.error.code).toBe('core.not_found');
    expect(runs).toEqual([]);
  });
});
