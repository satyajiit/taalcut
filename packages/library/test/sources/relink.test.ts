// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Moves and relink (ADR 0001, "Missing-file relink" and "Duplicates"): a
 * moved file keeps its asset id and analysis; a copy of known bytes merges
 * into the asset that has them; a file changed in place is new bytes, not a
 * relink; BLAKE3 breaks a tie between candidates the partial hash can't tell
 * apart; an asset detached by removing its source re-attaches on the rescan.
 */
import { randomBytes } from 'node:crypto';
import { copyFileSync, mkdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { unwrap, type AssetId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { hashAsset, PARTIAL_WINDOW_BYTES } from '../../src/index';
import { addAnalysedShot, library, shotsOf, writeMedia } from './fixture';

describe('moves and relink', () => {
  it('relinks a file renamed in its folder, keeping the asset, its shots and analysis', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    writeMedia(root, 'IMG_0001.MOV', 20_000);
    await lib.scan({ sourceId: id, mode: 'full' });
    const [before] = lib.locations(id);
    const shot = addAnalysedShot(lib.db, before!.assetId as AssetId);
    mkdirSync(join(root, 'Sunsets'));
    renameSync(join(root, 'IMG_0001.MOV'), join(root, 'Sunsets', 'beach.mov'));

    const counts = await lib.scan({ sourceId: id, mode: 'full' });
    expect(counts).toMatchObject({ moved: 1, added: 0, missing: 0 });
    expect(lib.locations(id)).toEqual([
      expect.objectContaining({
        id: before!.id,
        assetId: before!.assetId,
        path: 'Sunsets/beach.mov',
        state: 'present',
        via: 'relink',
      }),
    ]);
    expect(shotsOf(lib.db, before!.assetId as string)).toEqual([
      { id: shot, description: 'sunset on the beach' },
    ]);
    expect(lib.assetCount()).toBe(1);
  });

  it('relinks either way round in a paths scan: new path first, or the old one first', async () => {
    for (const order of [
      ['new.mov', 'old.mov'],
      ['old.mov', 'new.mov'],
    ]) {
      const lib = library();
      const { id, root } = lib.addFolder();
      writeMedia(root, 'old.mov', 9000);
      await lib.scan({ sourceId: id, mode: 'full' });
      const [before] = lib.locations(id);
      renameSync(join(root, 'old.mov'), join(root, 'new.mov'));
      await lib.scan({ sourceId: id, mode: 'paths', paths: order });
      expect(lib.locations(id)).toEqual([
        expect.objectContaining({ assetId: before!.assetId, path: 'new.mov', state: 'present' }),
      ]);
    }
  });

  it('relinks a file moved into another watched folder on the same volume', async () => {
    const lib = library();
    const trip = lib.addFolder('Trip');
    const best = lib.addFolder('Best');
    writeMedia(trip.root, 'wave.mov', 12_000);
    await lib.scan({ sourceId: trip.id, mode: 'full' });
    const [before] = lib.locations(trip.id);
    renameSync(join(trip.root, 'wave.mov'), join(best.root, 'wave.mov'));
    await lib.scan({ sourceId: best.id, mode: 'full' });
    expect(lib.locations(best.id)).toEqual([
      expect.objectContaining({ id: before!.id, assetId: before!.assetId, path: 'wave.mov' }),
    ]);
    expect(lib.locations(trip.id)).toEqual([]);
  });

  it('treats a rename plus an edit as new bytes, and the old path as missing', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    writeMedia(root, 'take.mov', 8000);
    await lib.scan({ sourceId: id, mode: 'full' });
    const [before] = lib.locations(id);
    renameSync(join(root, 'take.mov'), join(root, 'take-edited.mov'));
    writeFileSync(join(root, 'take-edited.mov'), randomBytes(8000));
    await lib.scan({ sourceId: id, mode: 'full' });
    const after = lib.locations(id);
    expect(after.find((l) => l.path === 'take.mov')).toMatchObject({
      assetId: before!.assetId,
      state: 'missing',
    });
    expect(after.find((l) => l.path === 'take-edited.mov')?.assetId).not.toBe(before!.assetId);
  });

  it('makes bytes changed in place a new asset and detaches the old one', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    const path = writeMedia(root, 'clip.mov', 8000);
    await lib.scan({ sourceId: id, mode: 'full' });
    const [before] = lib.locations(id);
    writeFileSync(path, randomBytes(9000));
    await lib.scan({ sourceId: id, mode: 'full' });
    const [after] = lib.locations(id);
    expect(after!.assetId).not.toBe(before!.assetId);
    const old = lib.db.driver
      .prepare('SELECT detached_at FROM assets WHERE id = ?')
      .get(before!.assetId as string);
    expect(old?.detached_at).toEqual(expect.any(Number));
  });

  it('merges a copy of known bytes into the asset that has them, once hashed', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    writeMedia(root, 'a.mov', 10_000);
    await lib.scan({ sourceId: id, mode: 'full' });
    const [original] = lib.locations(id);
    unwrap(
      await hashAsset(
        { db: lib.db, hasher: lib.hasher },
        { assetId: original!.assetId as AssetId, generation: 0 },
      ),
    );
    copyFileSync(join(root, 'a.mov'), join(root, 'copy of a.mov'));
    await lib.scan({ sourceId: id, mode: 'full' });
    const provisional = lib.locations(id).find((l) => l.path === 'copy of a.mov')!;
    expect(provisional.assetId).not.toBe(original!.assetId); // Not a move: the old path still exists.

    const merged = unwrap(
      await hashAsset(
        { db: lib.db, hasher: lib.hasher },
        { assetId: provisional.assetId as AssetId, generation: 0 },
      ),
    );
    expect(merged.merged).toBe(original!.assetId);
    expect(lib.locations(id).map((l) => [l.path, l.assetId])).toEqual([
      ['a.mov', original!.assetId],
      ['copy of a.mov', original!.assetId],
    ]);
    expect(lib.assetCount()).toBe(1);
  });

  it('lets BLAKE3 decide between candidates with the same size and partial hash', async () => {
    const lib = library();
    const { id, root } = lib.addFolder();
    const size = 6 * PARTIAL_WINDOW_BYTES;
    const a = randomBytes(size);
    const b = Buffer.from(a);
    b[2 * PARTIAL_WINDOW_BYTES + 5] = (b[2 * PARTIAL_WINDOW_BYTES + 5]! + 1) % 256; // Outside every sampled window.
    writeMedia(root, 'one.mov', a);
    writeMedia(root, 'two.mov', b);
    await lib.scan({ sourceId: id, mode: 'full' });
    const [one, two] = lib.locations(id);
    for (const l of [one!, two!])
      unwrap(
        await hashAsset({ db: lib.db, hasher: lib.hasher }, { assetId: l.assetId as AssetId, generation: 0 }),
      );
    // Both go missing; only "two" comes back, under a new name and a new inode (copied, then removed),
    // so neither the partial hash nor the inode can tell the candidates apart.
    copyFileSync(join(root, 'two.mov'), join(root, 'renamed.mov'));
    unlinkSync(join(root, 'two.mov'));
    unlinkSync(join(root, 'one.mov'));
    await lib.scan({ sourceId: id, mode: 'full' });
    const relinked = lib.locations(id).find((l) => l.path === 'renamed.mov');
    expect(relinked).toMatchObject({ id: two!.id, assetId: two!.assetId });
    expect(lib.calls.full.some((p) => p.endsWith('renamed.mov'))).toBe(true);
  });

  it('re-attaches an asset detached by removing its source when the folder is added and scanned again', async () => {
    const lib = library();
    const first = lib.addFolder('Trip');
    writeMedia(first.root, 'beach.mov', 7000);
    await lib.scan({ sourceId: first.id, mode: 'full' });
    const [before] = lib.locations(first.id);
    addAnalysedShot(lib.db, before!.assetId as AssetId);
    unwrap(lib.repos.sources.remove(first.id));
    expect(lib.db.driver.prepare('SELECT detached_at FROM assets').get()?.detached_at).toEqual(
      expect.any(Number),
    );

    const again = unwrap(
      lib.repos.sources.add({
        id: first.id,
        kind: 'watched_folder',
        displayName: 'Trip',
        rootPath: first.root,
        volumeUuid: 'VOL-1',
      }),
    );
    const counts = await lib.scan({ sourceId: again.id, mode: 'full' });
    expect(counts).toMatchObject({ moved: 1, added: 0 });
    expect(lib.locations(first.id)).toEqual([
      expect.objectContaining({ assetId: before!.assetId, detachedAt: null }),
    ]);
    expect(shotsOf(lib.db, before!.assetId as string)).toHaveLength(1);
  });
});
