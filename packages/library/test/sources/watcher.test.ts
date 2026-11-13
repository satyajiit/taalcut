// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The folder watcher (P2-L2). Its timing logic runs on fake timers with a
 * fake backend: per-path debounce, a copy in progress waits until size and
 * mtime settle, a burst of 500 becomes one batch, lost events and errors fall
 * back to a full scan, and the set of watched sources follows the table.
 * watcher-fs.test.ts runs the "Done when" on real files with real fs.watch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { unwrap, type SourceId } from '@taalcut/core';
import {
  createFolderWatcher,
  createRepositories,
  type ScanSourceInput,
  type WatchBackend,
} from '../../src/index';
import { openTestDb } from '../helpers';

function fakeBackend() {
  const watchers = new Map<
    string,
    { onChange: (path: string | null) => void; onError: (cause: unknown) => void; closed: boolean }
  >();
  const backend: WatchBackend = {
    watch(root, onChange, onError) {
      const entry = { onChange, onError, closed: false };
      watchers.set(root, entry);
      return { close: () => void (entry.closed = true) };
    },
  };
  return { backend, watchers };
}

function setup() {
  const db = openTestDb({ file: false });
  const repos = createRepositories(db);
  const source = unwrap(
    repos.sources.add({ kind: 'watched_folder', displayName: 'Trip', rootPath: '/Trip' }),
  );
  const { backend, watchers } = fakeBackend();
  const files = new Map<string, { size: number; mtimeMs: number; directory?: boolean }>();
  const enqueued: ScanSourceInput[] = [];
  const watcher = createFolderWatcher({
    db,
    backend,
    volumesDir: '/Volumes',
    enqueue: (input) => enqueued.push(input),
    stat: async (path) => {
      const file = files.get(path);
      return file && { size: file.size, mtimeMs: file.mtimeMs, directory: file.directory ?? false };
    },
  });
  const event = (path: string | null) => watchers.get('/Trip')!.onChange(path);
  const paths = () => enqueued.filter((e) => e.mode === 'paths').flatMap((e) => e.paths ?? []);
  return { db, repos, source: source.id as SourceId, watchers, files, enqueued, watcher, event, paths };
}

describe('folder watcher', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('starts with a full scan of every watched folder, and watches /Volumes for drives', async () => {
    const s = setup();
    s.watcher.start();
    expect(s.enqueued).toEqual([{ sourceId: s.source, mode: 'full', via: 'watcher' }]);
    expect([...s.watchers.keys()].sort()).toEqual(['/Trip', '/Volumes']);
    s.watcher.stop();
  });

  it('waits for a quiet path, then for its size and mtime to settle, before one paths scan', async () => {
    const s = setup();
    s.watcher.start();
    s.enqueued.length = 0;
    s.files.set('/Trip/clip.mov', { size: 100, mtimeMs: 1 });
    s.event('clip.mov');
    await vi.advanceTimersByTimeAsync(1_500);
    s.event('clip.mov'); // Still being written: the 2 s debounce starts again.
    await vi.advanceTimersByTimeAsync(2_000);
    s.files.set('/Trip/clip.mov', { size: 200, mtimeMs: 2 }); // Grew between the two checks.
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.paths()).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_000); // Same size and mtime twice: ready, then batched for 2 s.
    expect(s.paths()).toEqual([]);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.enqueued).toEqual([{ sourceId: s.source, mode: 'paths', paths: ['clip.mov'], via: 'watcher' }]);
    s.watcher.stop();
  });

  it('scans a file that never settles after 10 minutes, as it is', async () => {
    const s = setup();
    s.watcher.start();
    let size = 0;
    s.files.set('/Trip/live.mov', { size, mtimeMs: 0 });
    const grow = setInterval(() => s.files.set('/Trip/live.mov', { size: ++size, mtimeMs: size }), 500);
    s.event('live.mov');
    await vi.advanceTimersByTimeAsync(599_000);
    expect(s.paths()).toEqual([]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(s.paths()).toEqual(['live.mov']);
    clearInterval(grow);
    s.watcher.stop();
  });

  it('turns a burst of 500 new files into one batch, and drops hidden and non-media paths', async () => {
    const s = setup();
    s.watcher.start();
    for (let i = 0; i < 500; i++) {
      s.files.set(`/Trip/card/${i}.mov`, { size: i, mtimeMs: i });
      s.event(`card/${i}.mov`);
    }
    s.files.set('/Trip/notes.txt', { size: 1, mtimeMs: 1 });
    s.event('notes.txt');
    s.event('.DS_Store');
    s.event('Lib.photoslibrary/x.mov');
    await vi.advanceTimersByTimeAsync(3_100);
    const batches = s.enqueued.filter((e) => e.mode === 'paths');
    expect(batches).toHaveLength(1);
    expect(batches[0]!.paths).toHaveLength(500);
    s.watcher.stop();
  });

  it('sends deletions and folders straight on (the scan sorts them out)', async () => {
    const s = setup();
    s.watcher.start();
    s.files.set('/Trip/New Folder', { size: 0, mtimeMs: 0, directory: true });
    s.event('gone.mov');
    s.event('New Folder');
    await vi.advanceTimersByTimeAsync(4_100);
    expect(s.paths().sort()).toEqual(['New Folder', 'gone.mov']);
    s.watcher.stop();
  });

  it('falls back to a full scan when events are lost or the watcher fails, and watches again', async () => {
    const s = setup();
    s.watcher.start();
    s.enqueued.length = 0;
    s.event(null);
    expect(s.enqueued).toEqual([{ sourceId: s.source, mode: 'full', via: 'watcher' }]);
    s.watchers.get('/Trip')!.onError(new Error('FSEvents dropped'));
    expect(s.enqueued).toHaveLength(2);
    const failed = s.watchers.get('/Trip');
    await vi.advanceTimersByTimeAsync(2_000); // The refresh opens a new watcher.
    expect(s.watchers.get('/Trip')).not.toBe(failed);
    s.watcher.stop();
  });

  it('follows the sources table: stops for a removed or unwatched source, starts for a new one', async () => {
    const s = setup();
    s.watcher.start();
    expect(s.watcher.watching()).toEqual([s.source]);
    unwrap(s.repos.sources.update(s.source, { watch: false }));
    const other = unwrap(
      s.repos.sources.add({ kind: 'watched_folder', displayName: 'Best', rootPath: '/Best' }),
    );
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.watcher.watching()).toEqual([other.id]);
    expect(s.watchers.get('/Trip')!.closed).toBe(true);
    s.watcher.stop();
    expect(s.watcher.watching()).toEqual([]);
  });

  it('rescans folders on drives when a drive mounts', async () => {
    const s = setup();
    const drive = unwrap(
      s.repos.sources.add({
        kind: 'watched_folder',
        displayName: 'Shoot',
        rootPath: '/Volumes/SSD/Shoot',
        status: 'offline',
      }),
    );
    s.watcher.start();
    s.enqueued.length = 0;
    s.watchers.get('/Volumes')!.onChange('SSD');
    expect(s.enqueued).toEqual([{ sourceId: drive.id, mode: 'full', via: 'watcher' }]);
    s.watcher.stop();
  });
});
