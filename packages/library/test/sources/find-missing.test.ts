// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Find missing files" (ADR 0001, user gesture): the job matches missing
 * locations by relative path, then partial hash, then BLAKE3 (required);
 * `library.relinkLocations` applies the candidates, re-checking size and
 * partial hash, and undo restores the locations as they were.
 */
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCommandBus, systemClock, unwrap, type AssetId, type CommandOrigin } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createLibraryCommands,
  createLibraryPorts,
  findMissingFiles,
  hashAsset,
  type AssetLocationId,
} from '../../src/index';
import { tempDir } from '../helpers';
import { fakeVolumes, library, writeMedia } from './fixture';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

/** A drive's folder that went away, its files now somewhere else on another path. */
async function missingFiles() {
  const lib = library();
  const { id, root } = lib.addFolder('Drive');
  writeMedia(root, 'Day 1/a.mov', 6000);
  writeMedia(root, 'Day 1/b.mov', 7000);
  writeMedia(root, 'c.mov', 8000);
  await lib.scan({ sourceId: id, mode: 'full' });
  for (const l of lib.locations(id)) {
    unwrap(
      await hashAsset({ db: lib.db, hasher: lib.hasher }, { assetId: l.assetId as AssetId, generation: 0 }),
    );
  }
  const elsewhere = join(tempDir(), 'Backup');
  mkdirSync(join(elsewhere, 'Day 1'), { recursive: true });
  renameSync(join(root, 'Day 1', 'a.mov'), join(elsewhere, 'Day 1', 'a.mov')); // same relative path
  mkdirSync(join(elsewhere, 'sorted'));
  renameSync(join(root, 'Day 1', 'b.mov'), join(elsewhere, 'sorted', 'renamed-b.mov')); // only the bytes
  await lib.scan({ sourceId: id, mode: 'full' });
  return { lib, sourceId: id, root, elsewhere };
}

describe('find missing files', () => {
  it('finds missing bytes by relative path, then by hash, verified with BLAKE3', async () => {
    const { lib, sourceId, elsewhere } = await missingFiles();
    writeMedia(elsewhere, 'decoy.mov', 6000); // Same size as a.mov, other bytes.
    const found = unwrap(
      await findMissingFiles({ db: lib.db, hasher: lib.hasher }, { searchIn: elsewhere, sourceId }),
    );
    const byPath = new Map(lib.locations(sourceId).map((l) => [l.id, l.path]));
    expect(
      found.candidates.map((c) => [byPath.get(c.locationId), c.path.slice(elsewhere.length)]).sort(),
    ).toEqual([
      ['Day 1/a.mov', '/Day 1/a.mov'],
      ['Day 1/b.mov', '/sorted/renamed-b.mov'],
    ]);
    expect(found.searched).toBeGreaterThanOrEqual(2);
    expect(found.candidates.every((c) => /^[0-9a-f]{64}$/.test(c.contentHash))).toBe(true);
  });

  it('relinks the candidates with the command, and undo puts the locations back', async () => {
    const { lib, sourceId, root, elsewhere } = await missingFiles();
    // The person points the source's own folder at the backup: copy back where the source can see them.
    mkdirSync(join(root, 'restored'));
    renameSync(join(elsewhere, 'Day 1', 'a.mov'), join(root, 'restored', 'a.mov'));
    const found = unwrap(
      await findMissingFiles(
        { db: lib.db, hasher: lib.hasher },
        { searchIn: join(root, 'restored'), sourceId },
      ),
    );
    expect(found.candidates).toHaveLength(1);

    const ports = createLibraryPorts(lib.db);
    const bus = createCommandBus({ store: ports.auditLog, clock: systemClock });
    const commands = createLibraryCommands({
      db: lib.db,
      folders: { protectedRoots: [] },
      commands: ports.commands,
      settings: ports.settings,
      defaultOriginalsRoot: join(tempDir(), 'Originals'),
      hasher: lib.hasher,
      volumes: fakeVolumes(),
    });
    bus.register(...commands.all);
    const [candidate] = found.candidates;
    unwrap(await bus.dispatch(commands.relinkLocations, { items: [candidate!] }, ui));
    const relinked = lib.locations(sourceId).find((l) => l.id === candidate!.locationId);
    expect(relinked).toMatchObject({
      path: 'restored/a.mov',
      state: 'present',
      via: 'relink',
      availability: 'online',
    });

    unwrap(await bus.undo(null, ui));
    expect(lib.locations(sourceId).find((l) => l.id === candidate!.locationId)).toMatchObject({
      path: 'Day 1/a.mov',
      state: 'missing',
    });
    unwrap(await bus.redo(null, ui));
    expect(lib.locations(sourceId).find((l) => l.id === candidate!.locationId)).toMatchObject({
      path: 'restored/a.mov',
    });
  });

  it('refuses a candidate whose file changed since the search, or that lies outside every source', async () => {
    const { lib, sourceId, root, elsewhere } = await missingFiles();
    const ports = createLibraryPorts(lib.db);
    const bus = createCommandBus({ store: ports.auditLog, clock: systemClock });
    const commands = createLibraryCommands({
      db: lib.db,
      folders: { protectedRoots: [] },
      commands: ports.commands,
      settings: ports.settings,
      defaultOriginalsRoot: join(tempDir(), 'Originals'),
      hasher: lib.hasher,
    });
    bus.register(...commands.all);
    const outside = unwrap(
      await findMissingFiles({ db: lib.db, hasher: lib.hasher }, { searchIn: elsewhere, sourceId }),
    );
    const away = await bus.dispatch(commands.relinkLocations, { items: [outside.candidates[0]!] }, ui);
    expect(!away.ok && away.error).toMatchObject({
      code: 'library.relink_mismatch',
      params: { name: expect.any(String) },
    });

    mkdirSync(join(root, 'back'));
    const target = join(root, 'back', 'a.mov');
    renameSync(join(elsewhere, 'Day 1', 'a.mov'), target);
    const found = unwrap(
      await findMissingFiles({ db: lib.db, hasher: lib.hasher }, { searchIn: join(root, 'back'), sourceId }),
    );
    writeFileSync(target, Buffer.alloc(6000, 1)); // Same size, other bytes.
    const changed = await bus.dispatch(commands.relinkLocations, { items: [found.candidates[0]!] }, ui);
    expect(!changed.ok && changed.error.code).toBe('library.relink_mismatch');
    const location = lib
      .locations(sourceId)
      .find((l) => l.id === (found.candidates[0]!.locationId as AssetLocationId));
    expect(location?.state).toBe('missing');
    expect(unwrap(await ports.auditLog.listByProject(null))).toHaveLength(0);
  });
});
