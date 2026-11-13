// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * library.scanSource (P2-L2): what a scan walks and skips, what it reads,
 * resuming after a kill from the saved cursor, missing and offline files,
 * permissions, a source removed mid-scan, and the watcher's path scans.
 */
import { chmodSync, mkdirSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createWasmContentHasher, type ContentHasher } from '../../src/index';
import { fakeVolumes, library, writeMedia } from './fixture';

describe('library.scanSource', () => {
  it('walks media in order, skipping hidden, AppleDouble, bundles, other files and symlinks', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    writeMedia(root, 'b/clip.mov');
    writeMedia(root, 'a.mp4');
    writeMedia(root, 'photo.HEIC');
    writeMedia(root, 'voice.m4a');
    writeMedia(root, '.hidden.mov');
    writeMedia(root, '._a.mp4');
    writeMedia(root, 'notes.txt');
    writeMedia(root, 'Old.photoslibrary/originals/x.mov');
    writeMedia(root, 'Edit.fcpbundle/media/y.mov');
    writeMedia(root, '.git/z.mov');
    symlinkSync(join(root, 'a.mp4'), join(root, 'link.mp4'));
    const outside = writeMedia(lib.addFolder('Elsewhere').root, 'far.mov');
    symlinkSync(join(outside, '..'), join(root, 'linked-folder'));

    const counts = await lib.scan({ sourceId: id, mode: 'full' });
    expect(counts).toMatchObject({ end: 'done', seen: 4, added: 4, missing: 0 });
    expect(lib.locations(id).map((l) => l.path)).toEqual(['a.mp4', 'b/clip.mov', 'photo.HEIC', 'voice.m4a']);
    const kinds = lib.db.driver
      .prepare('SELECT kind FROM assets ORDER BY original_filename')
      .all()
      .map((r) => r.kind);
    expect(kinds).toEqual(['video', 'video', 'image', 'audio']);
    const source = unwrap(lib.repos.sources.get(id));
    expect(source).toMatchObject({ scanState: 'idle', scanCursor: null, lastScanAt: expect.any(Number) });
  });

  it('reads nothing again for unchanged files, and only the partial hash for changed ones', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    writeMedia(root, 'a.mov');
    writeMedia(root, 'b.mov');
    await lib.scan({ sourceId: id, mode: 'full' });
    expect(lib.calls.partial).toHaveLength(2);
    expect(lib.calls.full).toHaveLength(0); // BLAKE3 is the hash stage's, not the scan's.
    const again = await lib.scan({ sourceId: id, mode: 'full' });
    expect(again).toMatchObject({ seen: 2, unchanged: 2, added: 0 });
    expect(lib.calls.partial).toHaveLength(2);
    expect(lib.assetCount()).toBe(2);
  });

  it('resumes after a kill from the saved cursor, without re-reading or losing files', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    for (let i = 0; i < 9; i++) writeMedia(root, `clip-${i}.mov`);
    const killer = new AbortController();
    const base = createWasmContentHasher();
    let reads = 0;
    const dying: ContentHasher = {
      full: base.full,
      partial: async (path, options) => {
        if (++reads === 5) killer.abort(); // Stop during the third batch.
        return base.partial(path, options);
      },
    };
    const first = await import('../../src/index').then(({ scanSource }) =>
      scanSource(
        { db: lib.db, hasher: dying, volumes: fakeVolumes(), batchSize: 2 },
        { sourceId: id, mode: 'full' },
        killer.signal,
      ),
    );
    expect(!first.ok && first.error.code).toBe('core.cancelled');
    const stopped = unwrap(lib.repos.sources.get(id));
    expect(stopped.scanState).toBe('scanning');
    expect(stopped.scanCursor).toMatch(/^\d+:clip-3\.mov$/);
    expect(lib.locations(id)).toHaveLength(4);

    const resumed = await lib.scan({ sourceId: id, mode: 'full' }, { batchSize: 2 });
    expect(resumed).toMatchObject({ end: 'done', seen: 5, added: 5, missing: 0 });
    // Only the files after the cursor were read again.
    expect(lib.calls.partial.map((p) => p.split('/').pop())).toEqual(
      [4, 5, 6, 7, 8].map((i) => `clip-${i}.mov`),
    );
    expect(lib.locations(id).map((l) => l.state)).toEqual(Array(9).fill('present'));
    expect(unwrap(lib.repos.sources.get(id)).scanCursor).toBeNull();
  });

  it('marks files the scan no longer finds missing, and present again when they return', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    const gone = writeMedia(root, 'gone.mov', Buffer.alloc(5000, 7));
    writeMedia(root, 'stays.mov');
    await lib.scan({ sourceId: id, mode: 'full' });
    unlinkSync(gone);
    const counts = await lib.scan({ sourceId: id, mode: 'full' });
    expect(counts.missing).toBe(1);
    const missing = lib.locations(id).find((l) => l.path === 'gone.mov')!;
    expect(missing).toMatchObject({
      state: 'missing',
      availability: 'missing',
      missingSince: expect.any(Number),
    });
    writeFileSync(gone, Buffer.alloc(5000, 7));
    await lib.scan({ sourceId: id, mode: 'full' });
    expect(lib.locations(id).find((l) => l.path === 'gone.mov')).toMatchObject({
      state: 'present',
      missingSince: null,
    });
  });

  it('makes a source on an unmounted volume offline, never missing; a gone root on a mounted one missing', async () => {
    const ejected = library({ volumes: fakeVolumes([]) });
    const a = ejected.addFolder('Drive');
    writeMedia(a.root, 'x.mov');
    await ejected.scan({ sourceId: a.id, mode: 'full' });
    rmSync(a.root, { recursive: true });
    expect(await ejected.scan({ sourceId: a.id, mode: 'full' })).toMatchObject({ end: 'offline' });
    expect(unwrap(ejected.repos.sources.get(a.id)).status).toBe('offline');
    expect(ejected.locations(a.id)).toMatchObject([
      { state: 'offline', availability: 'offline', missingSince: null },
    ]);

    const mounted = library();
    const b = mounted.addFolder('Folder');
    writeMedia(b.root, 'y.mov');
    await mounted.scan({ sourceId: b.id, mode: 'full' });
    rmSync(b.root, { recursive: true });
    expect(await mounted.scan({ sourceId: b.id, mode: 'full' })).toMatchObject({ end: 'missing' });
    expect(unwrap(mounted.repos.sources.get(b.id)).status).toBe('missing');
    expect(mounted.locations(b.id)).toMatchObject([{ state: 'missing' }]);

    // Back on the volume: online again, files present.
    mkdirSync(b.root);
    writeMedia(b.root, 'y.mov');
    await mounted.scan({ sourceId: b.id, mode: 'full' });
    expect(unwrap(mounted.repos.sources.get(b.id)).status).toBe('online');
  });

  it('reports a folder macOS won’t let it read, with the folder’s name', async () => {
    const lib = library();
    const { id, root } = lib.addFolder('Private');
    writeMedia(root, 'x.mov');
    chmodSync(root, 0o000);
    try {
      const counts = await lib.scan({ sourceId: id, mode: 'full' });
      expect(counts.end).toBe('permission-denied');
      const source = unwrap(lib.repos.sources.get(id));
      expect(source.scanState).toBe('error');
      expect(source.scanError).toMatchObject({
        code: 'library.folder_permission_denied',
        params: { name: 'Private' },
      });
      expect(source.scanError).not.toHaveProperty('detail');
    } finally {
      chmodSync(root, 0o755);
    }
  });

  it('ends skipped, writing nothing, when the source is removed while it runs', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    writeMedia(root, 'a.mov');
    const base = createWasmContentHasher();
    const removing: ContentHasher = {
      full: base.full,
      partial: async (path, options) => {
        unwrap(lib.repos.sources.remove(id));
        return base.partial(path, options);
      },
    };
    expect(await lib.scan({ sourceId: id, mode: 'full' }, { hasher: removing })).toMatchObject({
      end: 'source-removed',
    });
    expect(lib.assetCount()).toBe(0);
    expect(await lib.scan({ sourceId: id, mode: 'full' })).toMatchObject({ end: 'source-removed', seen: 0 });
  });

  it('scans just the paths a watcher saw: new files, deletions and whole folders', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    const old = writeMedia(root, 'old.mov');
    await lib.scan({ sourceId: id, mode: 'full' });
    unlinkSync(old);
    writeMedia(root, 'new.mov');
    writeMedia(root, 'Day 2/one.mp4');
    writeMedia(root, 'Day 2/two.mp4');
    writeMedia(root, 'readme.txt');
    const counts = await lib.scan({
      sourceId: id,
      mode: 'paths',
      paths: ['old.mov', 'new.mov', 'Day 2', 'readme.txt', '../escape.mov'],
      via: 'watcher',
    });
    expect(counts).toMatchObject({ end: 'done', added: 3, missing: 1, skipped: 2 });
    expect(lib.locations(id).map((l) => [l.path, l.state, l.via])).toEqual([
      ['Day 2/one.mp4', 'present', 'watcher'],
      ['Day 2/two.mp4', 'present', 'watcher'],
      ['new.mov', 'present', 'watcher'],
      ['old.mov', 'missing', 'scan'],
    ]);
  });
});
