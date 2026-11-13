// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2 round 4 end to end, with real FFmpeg and real files: a jobs process that restarts while a window shows a clip
 * keeps that clip's files through its start's run, and closing the page lets them go. Main's list of the clips the
 * windows show (main/open-clips.ts, watching a window as it would Electron's) is written to the library over main's
 * own connection. Each jobs process here is made anew over the same database file and cache folder (the library's
 * pipeline, the queue, the media cache and its cap), so nothing it held in memory survives the restart; it reads
 * main's list before each file goes. The start's run comes after the usual debounce, with no grace.
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
  createIndexingPipeline,
  createRepositories,
  FILE_EVICTED,
  offlineContentHashes,
  openDatabase,
  saveOpenClips,
} from '@taalcut/library';
import { createTestQueue, runPipeline } from '@taalcut/library/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createOpenClips } from '../src/main/open-clips';
import { wireMediaJobs } from '../src/utility/roots/media-jobs';
import { addClip, clipFolder, clipStages } from './helpers/clip-import';
import { fakeClipWindow } from './helpers/clip-window';
import { registrationHandlers } from './helpers/index-queue';
import { testConfig } from './helpers/roots';
import { testFfmpeg } from './helpers/test-ffmpeg';

const userData = await mkdtemp(join(tmpdir(), 'taalcut-cache-restart-'));
const dbPath = join(userData, 'library.sqlite');
// Skips only without FFmpeg; FFmpeg whose check fails fails the suite (UX2-FIXUP).
const ffmpeg = await testFfmpeg('the media cache across a jobs restart');

/** Settings' cap, as each run reads it: as large as the default while the clips come in. */
let cap = 20_000_000_000;

/** One jobs process: everything it keeps in memory is made here, over the database file and the cache folder. */
function startJobs() {
  const db = unwrap(openDatabase({ path: dbPath }));
  const bus = createEventBus({ clock: systemClock });
  const failures: string[] = [];
  const media = wireMediaJobs(testConfig('jobs', dbPath, userData));
  const { stages, job } = clipStages(db);
  const queue = createTestQueue(db, bus, registrationHandlers([...media.jobs, job], failures));
  const pipeline = createIndexingPipeline({ db, queue, events: bus, stages, log: () => {} });
  media.attach(bus, {
    queue: () => queue,
    capBytes: () => Promise.resolve(ok(cap)),
    release: (key) => pipeline.release(key),
    offlineHashes: () => offlineContentHashes(db),
    delayMs: 50,
  });
  return {
    db,
    bus,
    failures,
    media,
    pipeline,
    run: () => runPipeline(pipeline, queue),
    /** The process goes: its timers stop and its connection closes; nothing of it carries over. */
    stop() {
      media.stopCap();
      pipeline.stop();
      db.close();
    },
  };
}

/** The start's run (the wiring's checkCap, as jobs-root's start calls it), and the files it let go. */
async function startsRun(jobs: ReturnType<typeof startJobs>): Promise<EventPayload<'media.derivedEvicted'>> {
  const queued = new Promise<void>((resolve) => {
    const off = jobs.bus.on('job.stateChanged', ({ payload }) => {
      if (payload.kind !== 'media.enforceCacheCap' || payload.from !== null) return;
      off();
      resolve();
    });
  });
  const evicted = new Promise<EventPayload<'media.derivedEvicted'>>((resolve) => {
    const off = jobs.bus.on('media.derivedEvicted', ({ payload }) => {
      off();
      resolve(payload);
    });
  });
  jobs.media.checkCap();
  await queued;
  await jobs.run();
  return evicted;
}

describe.skipIf(!ffmpeg.ok)('the media cache across a jobs-process restart', { timeout: 240_000 }, () => {
  // Main: its own connection, and the list of open clips written empty at its start.
  const mainDb = unwrap(openDatabase({ path: dbPath }));
  const openClips = createOpenClips((assetIds) => saveOpenClips(mainDb, assetIds).ok);
  const win = fakeClipWindow();
  openClips.watch(win);
  let jobs = startJobs();
  /** Imported one after the other: the open clip's files are the least recently used. */
  let open: AssetId;
  let other: AssetId;

  beforeAll(async () => {
    const folder = { id: clipFolder(jobs.db, userData), dir: userData };
    await jobs.pipeline.start({ poll: false });
    open = await addClip(jobs.media.service, jobs.db, folder, 'open.mkv', { seconds: 6, hz: 440 });
    await jobs.run();
    other = await addClip(jobs.media.service, jobs.db, folder, 'other.mkv', { seconds: 6, hz: 550 });
    await jobs.run();
    // Two clips through FFmpeg: the suite's limit, not the hooks' 10 s.
  }, 240_000);
  afterAll(async () => {
    jobs.stop();
    mainDb.close();
    await rm(userData, { recursive: true, force: true });
  });

  const files = () => createRepositories(mainDb).derivedFiles;
  const fileOf = (assetId: AssetId, kind: DerivedKind) =>
    files()
      .forAsset(assetId)
      .find((ref) => ref.kind === kind)?.key ?? '';
  const onDisk = (key: string) => existsSync(jobs.media.cache.absPath(key) ?? '');
  const bytesOf = (key: string) => statSync(jobs.media.cache.absPath(key) ?? '').size;

  it('keeps the files of the clip a window shows through a restarted process’s start run', async () => {
    expect(jobs.failures).toEqual([]);
    win.go(`/library/${open}`);
    const openFiles = files().forAsset(open);
    expect(openFiles.map((ref) => ref.kind)).toEqual(
      expect.arrayContaining(['proxy', 'waveform', 'filmstrip']),
    );
    // Over the cap by the other clip's copy and half its waveform. The open clip's copy and waveform are the oldest,
    // so without main's list the run would take them first.
    const others = [fileOf(other, 'proxy'), fileOf(other, 'waveform')];
    const usage = jobs.media.cache.usage().bytes;
    cap = Math.round((usage - bytesOf(others[0] ?? '') - Math.floor(bytesOf(others[1] ?? '') / 2)) / 0.9);
    expect(usage).toBeGreaterThan(cap);
    jobs.stop();

    jobs = startJobs();
    await jobs.pipeline.start({ poll: false });
    const { keys } = await startsRun(jobs);

    expect(jobs.failures).toEqual([]);
    expect(keys).toEqual(others);
    expect(files().forAsset(open)).toEqual(openFiles);
    expect(openFiles.every((ref) => onDisk(ref.key))).toBe(true);
    expect(jobs.media.cache.usage().bytes).toBeLessThanOrEqual(Math.floor(cap * 0.9));
  });

  it('lets them go at the next run once the page closes', async () => {
    const copy = fileOf(open, 'proxy');
    win.go('/library');
    const usage = jobs.media.cache.usage().bytes;
    cap = Math.round((usage - Math.floor(bytesOf(copy) / 2)) / 0.9);
    expect(usage).toBeGreaterThan(cap);
    const { keys } = await startsRun(jobs);

    expect(jobs.failures).toEqual([]);
    expect(keys).toEqual([copy]);
    expect(onDisk(copy)).toBe(false);
    expect(files().hasKey(copy)).toBe(false);
    const marked = mainDb.driver
      .prepare(`SELECT stage FROM asset_index_stages WHERE asset_id = ? AND reason_key = ?`)
      .all(open, FILE_EVICTED);
    expect(marked).toEqual([{ stage: 'media.proxy' }]);
  });
});
