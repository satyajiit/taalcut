// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2 round 3 end to end, with real FFmpeg: the media cache kept to a small cap. Three clips are imported through
 * media's real stages; the cap is then set below what they take. At start the jobs process's wiring enqueues
 * `media.enforceCacheCap`, which evicts the least recently used files down to 90 % of the cap, asking the library
 * before each: the clip a window shows (main's list of open clips, round 4) keeps all of its files (main still serves
 * its copy by range), the others' rows go as their files do. Opening an evicted clip makes its files again; the put
 * that crosses the cap starts the next run, which takes only what no open clip holds. A jobs process restarting under
 * an open clip: cache-cap-restart.test.ts.
 */
import { existsSync, statSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createEventBus,
  ok,
  systemClock,
  unwrap,
  type AssetId,
  type DerivedKind,
  type EventPayload,
} from '@taalcut/core';
import {
  assetDetail,
  createIndexingPipeline,
  createRepositories,
  FILE_EVICTED,
  offlineContentHashes,
  openDatabase,
  saveOpenClips,
} from '@taalcut/library';
import { createTestQueue, runPipeline } from '@taalcut/library/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { planMediaRequest } from '../src/main/protocol/media-protocol';
import { wireMediaJobs } from '../src/utility/roots/media-jobs';
import { addClip, clipFolder, clipStages } from './helpers/clip-import';
import { registrationHandlers } from './helpers/index-queue';
import { testConfig } from './helpers/roots';
import { testFfmpeg } from './helpers/test-ffmpeg';

const userData = await mkdtemp(join(tmpdir(), 'taalcut-cache-cap-'));
const media = wireMediaJobs(testConfig('jobs', ':memory:', userData));
// Skips only without FFmpeg; FFmpeg whose check fails fails the suite (UX2-FIXUP).
const ffmpeg = await testFfmpeg('the media cache’s cap');

describe.skipIf(!ffmpeg.ok)('the media cache kept to its cap', { timeout: 240_000 }, () => {
  const bus = createEventBus({ clock: systemClock });
  const db = unwrap(openDatabase({ path: ':memory:' }));
  const failures: string[] = [];
  const { stages, job } = clipStages(db);
  const queue = createTestQueue(db, bus, registrationHandlers([...media.jobs, job], failures));
  const pipeline = createIndexingPipeline({ db, queue, events: bus, stages, log: () => {} });
  const run = () => runPipeline(pipeline, queue);
  const files = createRepositories(db).derivedFiles;
  // Settings' cap: as large as the default while the clips come in.
  let cap = 20_000_000_000;
  media.attach(bus, {
    queue: () => queue,
    capBytes: () => Promise.resolve(ok(cap)),
    release: (key) => pipeline.release(key),
    offlineHashes: () => offlineContentHashes(db),
    delayMs: 50,
  });
  /** The clips imported one after the other: the first's files are the least recently used. */
  const clips: AssetId[] = [];
  /** The first clip's copy, as it was before it was evicted. */
  let firstCopyBytes = 0;

  beforeAll(async () => {
    const folder = { id: clipFolder(db, userData), dir: userData };
    await pipeline.start({ poll: false });
    for (const [i, hz] of [440, 550, 660].entries()) {
      clips.push(await addClip(media.service, db, folder, `clip-${i}.mkv`, { seconds: 6, hz }));
      await run();
    }
    // Three clips through FFmpeg: the suite's limit, not the hooks' 10 s.
  }, 240_000);
  afterAll(async () => {
    media.stopCap();
    pipeline.stop();
    db.close();
    await rm(userData, { recursive: true, force: true });
  });

  const fileOf = (assetId: AssetId, kind: DerivedKind) =>
    files.forAsset(assetId).find((ref) => ref.kind === kind);
  const bytesOf = (key: string | undefined) => (key ? statSync(media.cache.absPath(key) ?? '').size : 0);
  const onDisk = (key: string) => existsSync(media.cache.absPath(key) ?? '');
  /** The next `media.enforceCacheCap` the wiring enqueues, and then its run's announcement. */
  const nextRun = () =>
    new Promise<void>((resolve) => {
      const off = bus.on('job.stateChanged', ({ payload }) => {
        if (payload.kind !== 'media.enforceCacheCap' || payload.from !== null) return;
        off();
        resolve();
      });
    });
  const nextEviction = () =>
    new Promise<EventPayload<'media.derivedEvicted'>>((resolve) => {
      const off = bus.on('media.derivedEvicted', ({ payload }) => {
        off();
        resolve(payload);
      });
    });

  it('has every clip’s files once they are imported', () => {
    expect(failures).toEqual([]);
    for (const clip of clips) {
      const kinds = files.forAsset(clip).map((ref) => ref.kind);
      expect(kinds).toEqual(expect.arrayContaining(['proxy', 'filmstrip', 'waveform', 'thumbnail']));
      expect(files.forAsset(clip).every((ref) => onDisk(ref.key))).toBe(true);
    }
  });

  it('at start, evicts the least recently used files down to 90 % of the cap, but none of the open clip’s', async () => {
    const [first, second, open] = clips as [AssetId, AssetId, AssetId];
    unwrap(saveOpenClips(db, [open])); // main: a window shows it
    const proxy = (clip: AssetId) => fileOf(clip, 'proxy')?.key ?? '';
    const wave = (clip: AssetId) => fileOf(clip, 'waveform')?.key ?? '';
    // A cap that takes the first clip's copy and waveform and the second's copy to keep (proxies and waveforms go
    // before thumbnails and filmstrips, the oldest first).
    const usage = media.cache.usage().bytes;
    const target =
      usage - bytesOf(proxy(first)) - bytesOf(wave(first)) - Math.floor(bytesOf(proxy(second)) / 2);
    cap = Math.round(target / 0.9);
    expect(usage).toBeGreaterThan(cap);
    const openFiles = files.forAsset(open);
    const expected = [proxy(first), wave(first), proxy(second)];
    firstCopyBytes = bytesOf(proxy(first));

    const queued = nextRun();
    media.checkCap();
    await queued;
    const evicted = nextEviction();
    await run();
    const { keys } = await evicted;

    expect(failures).toEqual([]);
    expect(keys).toEqual(expected);
    expect(keys.some(onDisk)).toBe(false);
    expect(media.cache.usage().bytes).toBeLessThanOrEqual(Math.floor(cap * 0.9));
    // The library let them go as they went: no row names a missing file, and their stages are marked.
    expect(keys.some((key) => files.hasKey(key))).toBe(false);
    expect(unwrap(assetDetail(db, first)).playback).toBeNull();
    expect(fileOf(second, 'proxy')).toBeUndefined();
    const marked = db.driver
      .prepare(`SELECT stage FROM asset_index_stages WHERE asset_id = ? AND reason_key = ? ORDER BY stage`)
      .all(first, FILE_EVICTED);
    expect(marked).toEqual([{ stage: 'media.previews' }, { stage: 'media.proxy' }]);
    // The open clip keeps everything, and main still serves its copy a range at a time.
    expect(files.forAsset(open)).toEqual(openFiles);
    expect(openFiles.every((ref) => onDisk(ref.key))).toBe(true);
    const range = planMediaRequest(
      {
        url: `app://media/${proxy(open)}`,
        method: 'GET',
        headers: { get: (name) => (name === 'range' ? 'bytes=1000-1999' : null) },
      },
      media.cache.root,
      (path) => (existsSync(path) ? statSync(path).size : undefined),
    );
    expect(range).toMatchObject({ kind: 'file', range: { start: 1000, end: 1999 } });
  });

  it('makes an evicted clip’s files again when it is opened; the put over the cap runs again, sparing open clips', async () => {
    const [first, second, open] = clips as [AssetId, AssetId, AssetId];
    const secondsBefore = files.forAsset(second).map((ref) => ref.key);
    // Its copy made again is what crosses the cap (the run before left the cache at 90 % of it, at most).
    expect(media.cache.usage().bytes + firstCopyBytes).toBeGreaterThan(cap);
    // A second window opens it: main lists it, and its page asks for what was let go.
    unwrap(saveOpenClips(db, [first, open]));
    unwrap(await pipeline.prioritise([first]));
    const queued = nextRun();
    const evicted = nextEviction();
    await run();
    await queued;
    await run();
    const { keys } = await evicted;

    expect(failures).toEqual([]);
    const back = unwrap(assetDetail(db, first));
    expect(back.playback?.source).toBe('proxy');
    for (const clip of [first, open]) expect(files.forAsset(clip).every((ref) => onDisk(ref.key))).toBe(true);
    // Only the clip nobody has open gave anything up.
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((key) => secondsBefore.includes(key))).toBe(true);
  });
});
