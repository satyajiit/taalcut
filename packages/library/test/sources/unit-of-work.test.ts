// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * library.addSource over createLibraryPorts on a real database file: the
 * Source row commits with its audit row or not at all, and undo and redo
 * still work after the library is closed and opened again.
 */
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createCommandBus, err, systemClock, unwrap, type CommandOrigin } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import {
  Conflict,
  createLibraryPorts,
  createRepositories,
  createSourceCommands,
  openDatabase,
  type SourceRepository,
} from '../../src/index';
import { tempDir } from '../helpers';

const ui: CommandOrigin = { source: 'ui', actor: 'user' };

function folders() {
  const root = realpathSync(tempDir());
  const trip = join(root, 'Trip');
  mkdirSync(trip);
  return { root, trip, file: join(root, 'library.db') };
}

/** One process's view of the library: database, ports, bus and the source commands. */
function open(file: string, wrap: (sources: SourceRepository) => SourceRepository = (s) => s) {
  const db = unwrap(openDatabase({ path: file }));
  const repos = createRepositories(db);
  const ports = createLibraryPorts(db);
  const bus = createCommandBus({ store: ports.auditLog, clock: systemClock });
  const commands = createSourceCommands({
    sources: wrap(repos.sources),
    folders: { protectedRoots: [] },
    commands: ports.commands,
  });
  bus.register(commands.addSource, commands.removeSource);
  const audit = async () => unwrap(await ports.auditLog.listByProject(null));
  return { db, repos, bus, commands, audit };
}

describe('library.addSource with the command unit of work', () => {
  it('writes the Source row and the audit row together', async () => {
    const { trip, file } = folders();
    const app = open(file);
    const receipt = unwrap(await app.bus.dispatch(app.commands.addSource, { path: trip }, ui, { idempotencyKey: 'k1' }));
    expect(unwrap(app.repos.sources.get(receipt.result.id))).toMatchObject({ rootPath: trip });
    expect(await app.audit()).toMatchObject([
      { id: receipt.id, name: 'library.addSource', idempotencyKey: 'k1', result: { id: receipt.id, path: trip } },
    ]);
    // A repeated key returns the stored receipt and writes nothing.
    const again = unwrap(await app.bus.dispatch(app.commands.addSource, { path: trip }, ui, { idempotencyKey: 'k1' }));
    expect(again).toMatchObject({ deduplicated: true, id: receipt.id });
    expect(app.repos.sources.list()).toHaveLength(1);
    app.db.close();
  });

  it('writes neither when the staged write fails at commit', async () => {
    const { trip, file } = folders();
    const failing = (sources: SourceRepository): SourceRepository => ({
      ...sources,
      add: () => err(Conflict({ entity: 'source' }, { detail: 'taken at commit time' })),
    });
    const app = open(file, failing);
    const result = await app.bus.dispatch(app.commands.addSource, { path: trip }, ui);
    expect(!result.ok && result.error.code).toBe('library.conflict');
    expect(app.repos.sources.list()).toEqual([]);
    expect(await app.audit()).toEqual([]);
    app.db.close();
  });

  it('undoes and redoes across a restart, with the same source id', async () => {
    const { trip, file } = folders();
    const first = open(file);
    const id = unwrap(await first.bus.dispatch(first.commands.addSource, { path: trip, name: 'Trip' }, ui)).result.id;
    first.db.close();

    const second = open(file);
    expect(unwrap(await second.bus.history(null)).undo).toBe('library.addSource');
    unwrap(await second.bus.undo(null, ui));
    expect(second.repos.sources.list()).toEqual([]);
    second.db.close();

    const third = open(file);
    expect(unwrap(await third.bus.history(null))).toEqual({ undo: null, redo: 'library.addSource' });
    unwrap(await third.bus.redo(null, ui));
    expect(unwrap(third.repos.sources.get(id))).toMatchObject({ displayName: 'Trip', rootPath: trip });
    expect((await third.audit()).map((e) => [e.name, e.undone])).toEqual([['library.addSource', false]]);
    third.db.close();
  });
});
