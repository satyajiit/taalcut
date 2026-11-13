// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The library commands over core's bus and the unit of work (P2-L2): adding
 * a source stages its first scan in the same transaction; removing detaches
 * its assets and undo re-attaches them on the rescan; renames, watching,
 * the trash and the originals root undo; rescans and find-missing are reads
 * that only enqueue.
 */
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createCommandBus, err, systemClock, unwrap, type CommandOrigin, type SourceId } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  createJobRepository,
  createLibraryCommands,
  createLibraryPorts,
  createRepositories,
  MAX_SOURCES,
  ORIGINALS_ROOT_SETTING,
  scanSource,
  type LibraryDatabase,
} from '../../src/index';
import { openTestDb, tempDir } from '../helpers';
import { countingHasher, fakeVolumes, writeMedia } from './fixture';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

function setup(db: LibraryDatabase = openTestDb()) {
  const home = realpathSync(tempDir());
  const originals = join(home, 'Movies', 'Taalcut', 'Originals');
  const ports = createLibraryPorts(db);
  const bus = createCommandBus({ store: ports.auditLog, clock: systemClock });
  const { hasher } = countingHasher();
  const commands = createLibraryCommands({
    db,
    folders: { protectedRoots: [join(home, 'AppData')], home },
    commands: ports.commands,
    settings: ports.settings,
    defaultOriginalsRoot: originals,
    hasher,
    volumes: fakeVolumes(),
  });
  bus.register(...commands.all);
  const repos = createRepositories(db);
  const jobs = () => createJobRepository(db).list();
  const folder = (name: string) => {
    const path = join(home, name);
    mkdirSync(path, { recursive: true });
    return path;
  };
  const scanAll = async () => {
    for (const job of jobs().filter((j) => j.kind === 'library.scanSource' && j.state === 'queued')) {
      const input = job.payload as { sourceId: SourceId; mode: 'full' };
      unwrap(await scanSource({ db, hasher, volumes: fakeVolumes() }, input));
      unwrap(createJobRepository(db).cancel(job.id));
    }
  };
  return { db, ports, bus, commands, repos, jobs, folder, scanAll, home, originals };
}

describe('library commands', () => {
  it('adds a source and its first full scan in one transaction, with its volume', async () => {
    const s = setup();
    const trip = s.folder('Trip');
    const added = unwrap(await s.bus.dispatch(s.commands.addSource, { path: trip }, ui));
    expect(added.result).toMatchObject({ name: 'Trip', path: trip, scan: { jobId: expect.any(String) } });
    const source = unwrap(s.repos.sources.get(added.result.id));
    expect(source).toMatchObject({ watch: true, volumeUuid: 'VOL-1', volumeName: 'Disk' });
    expect(s.jobs()).toMatchObject([
      {
        id: added.result.scan!.jobId,
        kind: 'library.scanSource',
        resourceClass: 'io',
        payload: { sourceId: source.id, mode: 'full' },
      },
    ]);

    // A failing commit writes neither the source nor its scan.
    const db = openTestDb();
    const broken = setup(db);
    const append = broken.ports.auditLog.append;
    Object.assign(broken.ports.auditLog, {
      append: async () => err({ code: 'core.unknown', messageKey: 'x', retryable: false }),
    });
    const failed = await broken.bus.dispatch(broken.commands.addSource, { path: broken.folder('Other') }, ui);
    expect(failed.ok).toBe(false);
    expect(broken.repos.sources.list()).toEqual([]);
    expect(broken.jobs()).toEqual([]);
    Object.assign(broken.ports.auditLog, { append });
  });

  it('detaches a removed source’s assets and re-attaches them when undo adds it back', async () => {
    const s = setup();
    const trip = s.folder('Trip');
    writeMedia(trip, 'beach.mov', 9000);
    const { id } = unwrap(
      await s.bus.dispatch(s.commands.addSource, { path: trip, watch: false }, ui),
    ).result;
    await s.scanAll();
    const assetId = String(s.db.driver.prepare('SELECT id FROM assets').get()!.id);

    unwrap(await s.bus.dispatch(s.commands.removeSource, { sourceId: id }, ui));
    const detached = s.db.driver
      .prepare('SELECT detached_at, availability FROM assets WHERE id = ?')
      .get(assetId);
    expect(detached).toMatchObject({ detached_at: expect.any(Number), availability: 'missing' });

    unwrap(await s.bus.undo(null, ui));
    expect(unwrap(s.repos.sources.get(id))).toMatchObject({ rootPath: trip, watch: false });
    await s.scanAll();
    const back = s.db.driver.prepare('SELECT id, detached_at, availability FROM assets').all();
    expect(back).toEqual([{ id: assetId, detached_at: null, availability: 'online' }]);
  });

  it('renames a source and switches watching off, both undoable', async () => {
    const s = setup();
    const { id } = unwrap(await s.bus.dispatch(s.commands.addSource, { path: s.folder('Trip') }, ui)).result;
    unwrap(await s.bus.dispatch(s.commands.renameSource, { sourceId: id, name: 'Goa 2026' }, ui));
    unwrap(await s.bus.dispatch(s.commands.setSourceWatch, { sourceId: id, watch: false }, ui));
    expect(unwrap(s.repos.sources.get(id))).toMatchObject({ displayName: 'Goa 2026', watch: false });
    unwrap(await s.bus.undo(null, ui));
    unwrap(await s.bus.undo(null, ui));
    expect(unwrap(s.repos.sources.get(id))).toMatchObject({ displayName: 'Trip', watch: true });
  });

  it('enqueues rescans and find-missing as reads, without an audit entry', async () => {
    const s = setup();
    const { id } = unwrap(await s.bus.dispatch(s.commands.addSource, { path: s.folder('Trip') }, ui)).result;
    const entries = unwrap(await s.ports.auditLog.listByProject(null)).length;
    const first = unwrap(await s.bus.dispatch(s.commands.rescanSource, { sourceId: id }, ui));
    const second = unwrap(await s.bus.dispatch(s.commands.rescanSource, { sourceId: id }, ui));
    // The add's scan is still queued, so a rescan reuses it.
    expect(second.result.jobId).toBe(first.result.jobId);
    const find = unwrap(await s.bus.dispatch(s.commands.findMissing, { searchIn: '~/Backup' }, ui));
    expect(s.jobs().find((j) => j.id === find.result.jobId)).toMatchObject({
      kind: 'library.findMissingFiles',
      payload: { searchIn: join(s.home, 'Backup') },
    });
    expect(unwrap(await s.ports.auditLog.listByProject(null))).toHaveLength(entries);
  });

  it('moves assets to the trash and back, undoing only what changed', async () => {
    const s = setup();
    const trip = s.folder('Trip');
    writeMedia(trip, 'a.mov');
    writeMedia(trip, 'b.mov');
    unwrap(await s.bus.dispatch(s.commands.addSource, { path: trip }, ui));
    await s.scanAll();
    const [a, b] = s.db.driver
      .prepare('SELECT id FROM assets ORDER BY original_filename')
      .all()
      .map((r) => String(r.id));
    unwrap(await s.bus.dispatch(s.commands.trashAssets, { assetIds: [a!] }, ui));
    const both = unwrap(await s.bus.dispatch(s.commands.trashAssets, { assetIds: [a!, b!] }, ui));
    expect(both.result.assetIds).toEqual([b]);
    unwrap(await s.bus.undo(null, ui));
    const trashed = () =>
      s.db.driver
        .prepare('SELECT trashed_at FROM assets ORDER BY original_filename')
        .all()
        .map((r) => r.trashed_at !== null);
    expect(trashed()).toEqual([true, false]);
    unwrap(await s.bus.dispatch(s.commands.restoreAssets, { assetIds: [a!, b!] }, ui));
    expect(trashed()).toEqual([false, false]);
  });

  it('sets the originals root for new imports, refusing one that overlaps a watched folder', async () => {
    const s = setup();
    const trip = s.folder('Trip');
    unwrap(await s.bus.dispatch(s.commands.addSource, { path: trip }, ui));
    const nested = await s.bus.dispatch(s.commands.setOriginalsRoot, { path: join(trip, 'Phone') }, ui);
    expect(!nested.ok && nested.error.code).toBe('library.folder_not_allowed');
    const drive = join(s.home, 'Drive', 'Originals');
    unwrap(await s.bus.dispatch(s.commands.setOriginalsRoot, { path: drive }, ui));
    expect(unwrap(await s.ports.settings.get(ORIGINALS_ROOT_SETTING))).toBe(drive);
    unwrap(await s.bus.undo(null, ui));
    expect(unwrap(await s.ports.settings.get(ORIGINALS_ROOT_SETTING))).toBe(s.originals);
    // And a folder holding the originals root can't be watched.
    const movies = await s.bus.dispatch(s.commands.addSource, { path: s.folder('Movies') }, ui);
    expect(!movies.ok && movies.error.code).toBe('library.folder_not_allowed');
  });

  it('stops at the source limit', async () => {
    const s = setup();
    for (let i = 0; i < MAX_SOURCES; i++) {
      unwrap(
        s.repos.sources.add({ kind: 'watched_folder', displayName: `F${i}`, rootPath: `/nowhere/${i}` }),
      );
    }
    const over = await s.bus.dispatch(s.commands.addSource, { path: s.folder('One more') }, ui);
    expect(!over.ok && over.error).toMatchObject({
      code: 'library.too_many_sources',
      params: { limit: 100 },
    });
  });
});
