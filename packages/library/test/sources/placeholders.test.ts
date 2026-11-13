// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * iCloud placeholders (ADR 0001): a dataless candidate (no blocks on disk,
 * 64 KiB or more) is recorded as `icloud_placeholder` and never read, since
 * reading could start a download. The mac helper's status call, when there
 * is one, confirms or clears it. A dataless root is not recursed and not
 * marked missing.
 */
import { closeSync, openSync, ftruncateSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { isPlaceholder, PLACEHOLDER_MIN_BYTES, scanSource } from '../../src/index';
import { fakeVolumes, library, writeMedia } from './fixture';

/** A sparse file: its size, no blocks, like a dataless file. */
function dataless(root: string, name: string, size = 1 << 20): string {
  const path = join(root, name);
  const fd = openSync(path, 'w');
  ftruncateSync(fd, size);
  closeSync(fd);
  return path;
}

describe('iCloud placeholders', () => {
  it('records a dataless candidate as a placeholder without opening it', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    const cloud = dataless(root, 'in-icloud.mov');
    writeMedia(root, 'local.mov');
    const counts = await lib.scan({ sourceId: id, mode: 'full' });
    expect(counts).toMatchObject({ placeholders: 1, added: 1 });
    expect(lib.calls.partial).not.toContain(cloud);
    expect(lib.calls.full).not.toContain(cloud);
    const row = lib.locations(id).find((l) => l.path === 'in-icloud.mov');
    expect(row).toMatchObject({ state: 'icloud_placeholder', availability: 'icloud_placeholder' });
    // Still a placeholder on the next scan; still never read.
    await lib.scan({ sourceId: id, mode: 'full' });
    expect(lib.calls.partial).not.toContain(cloud);
  });

  it('lets the helper’s status call clear a candidate that is really local', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    const sparse = dataless(root, 'sparse-but-local.mov');
    const counts = unwrap(
      await scanSource(
        { db: lib.db, hasher: lib.hasher, volumes: fakeVolumes(), placeholders: async () => 'local' },
        { sourceId: id, mode: 'full' },
      ),
    );
    expect(counts).toMatchObject({ placeholders: 0, added: 1 });
    expect(lib.calls.partial).toContain(sparse);
  });

  it('needs no blocks and at least 64 KiB to be a candidate', async () => {
    expect(await isPlaceholder('/x', { blocks: 0, size: PLACEHOLDER_MIN_BYTES })).toBe(true);
    expect(await isPlaceholder('/x', { blocks: 0, size: PLACEHOLDER_MIN_BYTES - 1 })).toBe(false);
    expect(await isPlaceholder('/x', { blocks: 8, size: 1 << 20 })).toBe(false);
    expect(await isPlaceholder('/x', { blocks: 0, size: 1 << 20 }, async () => 'unknown')).toBe(true);
    expect(await isPlaceholder('/x', { blocks: 0, size: 1 << 20 }, async () => 'local')).toBe(false);
  });

  it('doesn’t recurse into a dataless root, nor mark it missing', async () => {
    const lib = library();
    const { id, root } = lib.addFolder('iCloud Folder');
    writeMedia(root, 'a.mov');
    const counts = unwrap(
      await scanSource(
        {
          db: lib.db,
          hasher: lib.hasher,
          volumes: fakeVolumes(),
          placeholders: async (path) => (path === root ? 'placeholder' : 'local'),
        },
        { sourceId: id, mode: 'full' },
      ),
    );
    expect(counts).toMatchObject({ end: 'dataless', seen: 0 });
    expect(lib.calls.partial).toHaveLength(0);
    expect(unwrap(lib.repos.sources.get(id)).status).toBe('online');
  });
});
