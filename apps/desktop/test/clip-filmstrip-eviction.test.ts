// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2 (clip lane, round 2) end to end, with real FFmpeg: the jobs process's media wiring (its cache reports
 * evictions on the process's bus) and the library's pipeline over media's real stages. A clip gets its copy to play
 * and its filmstrip at import; when the cache evicts them the library lets them go at once and makes nothing; when
 * the clip is opened they are made again, and the asset detail has them back.
 */
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEventBus, systemClock, unwrap, type AssetId } from '@taalcut/core';
import { assetDetail, createIndexingPipeline, createRepositories, openDatabase } from '@taalcut/library';
import { createTestQueue, runPipeline } from '@taalcut/library/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wireMediaJobs } from '../src/utility/roots/media-jobs';
import { addClip, clipFolder, clipStages } from './helpers/clip-import';
import { registrationHandlers } from './helpers/index-queue';
import { testConfig } from './helpers/roots';
import { testFfmpeg } from './helpers/test-ffmpeg';

const userData = await mkdtemp(join(tmpdir(), 'taalcut-clip-eviction-'));
const media = wireMediaJobs(testConfig('jobs', ':memory:', userData));
// Skips only without FFmpeg; FFmpeg whose check fails fails the suite (UX2-FIXUP).
const ffmpeg = await testFfmpeg('the clip’s files and the media cache');

describe.skipIf(!ffmpeg.ok)(
  'a clip’s copy and filmstrip the media cache lets go',
  { timeout: 240_000 },
  () => {
    const bus = createEventBus({ clock: systemClock });
    media.attach(bus);
    const db = unwrap(openDatabase({ path: ':memory:' }));
    const failures: string[] = [];
    const { stages, job } = clipStages(db);
    const queue = createTestQueue(db, bus, registrationHandlers([...media.jobs, job], failures));
    const pipeline = createIndexingPipeline({ db, queue, events: bus, stages, log: () => {} });
    const run = () => runPipeline(pipeline, queue);
    let clip: AssetId;

    beforeAll(async () => {
      clip = await addClip(media.service, db, { id: clipFolder(db, userData), dir: userData }, 'clip.mkv', {
        seconds: 6,
        hz: 440,
      });
      await pipeline.start({ poll: false });
      await run();
      // The fixture and the clip's whole import run with real FFmpeg: the suite's limit, not the hooks' 10 s.
    }, 240_000);
    afterAll(async () => {
      pipeline.stop();
      db.close();
      await rm(userData, { recursive: true, force: true });
    });

    const cached = (key: string | undefined) =>
      key !== undefined && existsSync(media.cache.absPath(key) ?? '');

    it('has both once the clip is imported', () => {
      expect(failures).toEqual([]);
      const detail = unwrap(assetDetail(db, clip));
      expect(detail.playback?.source).toBe('proxy');
      expect(detail.filmstrip?.times).toHaveLength(20);
      expect(detail.stages.find((row) => row.stage === 'media.filmstrip')?.state).toBe('done');
      expect(cached(detail.playback?.source === 'proxy' ? detail.playback.file.key : undefined)).toBe(true);
      expect(cached(detail.filmstrip?.file.key)).toBe(true);
    });

    it('lets them go the moment the cache evicts them, and makes nothing then', async () => {
      const before = unwrap(assetDetail(db, clip));
      const sprite = before.filmstrip?.file.key;
      const evicted = unwrap(await media.cache.enforceCap({ offlineHashes: [], pinned: [], capBytes: 1 }));
      expect(evicted.keys).toContain(sprite);
      await pipeline.idle();
      const after = unwrap(assetDetail(db, clip));
      expect([after.playback, after.filmstrip]).toEqual([null, null]);
      expect(createRepositories(db).derivedFiles.forAsset(clip)).toEqual([]);
      expect(cached(sprite)).toBe(false);
      expect(after.stages.find((row) => row.stage === 'media.proxy')?.state).toBe('done');
      const ran = queue.ran.length;
      await run();
      expect(queue.ran.length).toBe(ran);
    });

    it('makes them again when the clip is opened', async () => {
      const ran = queue.ran.length;
      unwrap(await pipeline.prioritise([clip]));
      await run();
      expect(failures).toEqual([]);
      expect(queue.ran.slice(ran).map((entry) => entry.split(' ')[0])).toEqual(
        expect.arrayContaining(['media.makeProxy', 'media.makeFilmstrip']),
      );
      const detail = unwrap(assetDetail(db, clip));
      expect(detail.playback?.source).toBe('proxy');
      expect(detail.filmstrip?.times).toHaveLength(20);
      expect(cached(detail.playback?.source === 'proxy' ? detail.playback.file.key : undefined)).toBe(true);
      expect(cached(detail.filmstrip?.file.key)).toBe(true);
    });
  },
);
