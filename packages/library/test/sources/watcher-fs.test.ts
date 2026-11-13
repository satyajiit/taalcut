// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-L2's "Done when", on real files with real fs.watch (FSEvents) and the
 * default timings: a new file in a watched folder is a library row within
 * 60 s (SPEC target: 10 s on this Mac), and a moved file relinks by content
 * hash, keeping its asset id and analysis. The jobs engine is stood in for by
 * running each enqueued scan in order. On a heavily loaded machine FSEvents
 * delivery can lag; the bound is the WP's 60 s, not loosened.
 */
import { open } from 'node:fs/promises';
import { mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createSerialQueue, unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import {
  createFolderWatcher,
  hashAsset,
  scanSource,
  type FolderWatcher,
  type ScanSourceInput,
} from '../../src/index';
import { addAnalysedShot, fakeVolumes, library, shotsOf, writeMedia } from './fixture';

const DONE_WHEN_MS = 60_000;

/** Runs each scan the watcher asks for, one after another, as the jobs engine would. */
function watch(lib: ReturnType<typeof library>): {
  watcher: FolderWatcher;
  scans: ScanSourceInput[];
  idle: () => Promise<void>;
} {
  const scans: ScanSourceInput[] = [];
  const queue = createSerialQueue();
  const runs: Promise<void>[] = [];
  const watcher = createFolderWatcher({
    db: lib.db,
    volumesDir: null,
    enqueue: (input) => {
      scans.push(input);
      runs.push(
        queue.run(async () => {
          unwrap(await scanSource({ db: lib.db, hasher: lib.hasher, volumes: fakeVolumes() }, input));
        }),
      );
    },
  });
  // A scan that failed fails the test that waits.
  return { watcher, scans, idle: async () => void (await Promise.all(runs)) };
}

describe('watched folders on disk', () => {
  it(
    'shows a new file, copied in over a few seconds, in the library well within 60 s',
    async () => {
      const lib = library();
      const { id, root } = lib.addFolder();
      const { watcher, idle } = watch(lib);
      watcher.start();
      await idle();
      expect(lib.assetCount()).toBe(0);

      const started = Date.now();
      // A card copy in progress: the file grows for ~1.5 s before it is complete.
      const file = await open(join(root, 'IMG_2041.MOV'), 'w');
      for (let i = 0; i < 6; i++) {
        await file.write(Buffer.alloc(64 * 1024, i));
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await file.close();
      await vi.waitFor(() => expect(lib.assetCount()).toBe(1), { timeout: DONE_WHEN_MS, interval: 100 });
      const tookMs = Date.now() - started;
      watcher.stop();
      await idle();
      console.warn(`[watcher] new file in the library after ${tookMs} ms`);
      expect(tookMs).toBeLessThan(DONE_WHEN_MS);
      // Seen once, complete: its size is the whole copy.
      expect(lib.locations(id)).toMatchObject([{ path: 'IMG_2041.MOV', state: 'present', via: 'watcher' }]);
      const size = lib.db.driver.prepare('SELECT size_bytes FROM assets').get()?.size_bytes;
      expect(size).toBe(6 * 64 * 1024);
    },
    DONE_WHEN_MS + 10_000,
  );

  it(
    'relinks a moved file by content hash, keeping its asset id and analysis',
    async () => {
      const lib = library();
      const { id, root } = lib.addFolder();
      writeMedia(root, 'beach.mov', 300_000);
      await lib.scan({ sourceId: id, mode: 'full' });
      const [before] = lib.locations(id);
      const assetId = before!.assetId as AssetId;
      unwrap(await hashAsset({ db: lib.db, hasher: lib.hasher }, { assetId, generation: 0 }));
      const shot = addAnalysedShot(lib.db, assetId);
      const { watcher, idle } = watch(lib);
      watcher.start();
      await idle();

      const started = Date.now();
      mkdirSync(join(root, 'Best of'));
      renameSync(join(root, 'beach.mov'), join(root, 'Best of', 'sunset at the beach.mov'));
      await vi.waitFor(
        () =>
          expect(lib.locations(id)).toMatchObject([
            { path: 'Best of/sunset at the beach.mov', state: 'present' },
          ]),
        { timeout: DONE_WHEN_MS, interval: 100 },
      );
      watcher.stop();
      await idle();
      console.warn(`[watcher] moved file relinked after ${Date.now() - started} ms`);
      expect(lib.locations(id)).toEqual([
        expect.objectContaining({ id: before!.id, assetId, via: 'relink' }),
      ]);
      expect(shotsOf(lib.db, assetId)).toEqual([{ id: shot, description: 'sunset on the beach' }]);
      expect(lib.assetCount()).toBe(1);
      const hash = lib.db.driver.prepare('SELECT content_hash FROM assets').get()?.content_hash;
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    },
    DONE_WHEN_MS + 10_000,
  );
});
