// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-X3: the timeline store. Revisions and conflicts (the port contract),
 * asset refs rewritten on every put and protecting used assets, the
 * automatic versions, validation, and puts staged with a command.
 */
import {
  createCommandBus,
  defineCommand,
  idSchema,
  newId,
  ok,
  systemClock,
  unwrap,
  type Timeline,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AUTO_VERSION_INTERVAL_MS,
  AUTO_VERSIONS_KEPT,
  createCommandUnitOfWork,
  createRepositories,
  createTimelineStore,
  type LibraryDatabase,
} from '../../src/index';
import { fakeClock, openTestDb } from '../helpers';
import { edited, seed, timeline } from './documents';
import { timelineStoreContract } from './timeline-store-contract';

/** A clock that moves 1 ms per read, so "most recent" is never a tie. */
function tickingDb(): LibraryDatabase {
  let now = Date.UTC(2026, 9, 12);
  return openTestDb({ file: false, clock: () => (now += 1) });
}

timelineStoreContract('library TimelineStore', () => {
  const db = tickingDb();
  const { project, assets } = seed(db);
  return { store: createTimelineStore(db), projectId: project.id, assets };
});

const refs = (db: LibraryDatabase, timelineId: string) =>
  db.driver
    .prepare('SELECT asset_id FROM timeline_asset_refs WHERE timeline_id = ? ORDER BY asset_id')
    .all(timelineId)
    .map((r) => r.asset_id);

describe('timeline store (library)', () => {
  it('rewrites asset refs on every put, and a used asset can’t be deleted', async () => {
    const db = tickingDb();
    const store = createTimelineStore(db);
    const { project, assets, repos } = seed(db);
    const other = unwrap(repos.assets.create({ kind: 'video', sizeBytes: 5, originalFilename: 'c.mov' })).id;
    const doc = timeline(project.id, assets);
    unwrap(await store.create(doc));
    expect(refs(db, doc.id)).toEqual([...assets].sort());
    const swapped = { ...timeline(project.id, [assets[0], other]), id: doc.id };
    unwrap(await store.put(swapped, 1));
    expect(refs(db, doc.id)).toEqual([assets[0], other].sort());
    expect(repos.assets.remove(other).ok).toBe(false); // RESTRICT: a timeline uses it
    expect(repos.assets.remove(assets[1]).ok).toBe(true); // no longer used
    const unknown = await store.put({ ...edited(doc, 50), id: doc.id }, 2);
    expect(!unknown.ok && unknown.error.code).toBe('library.constraint_violation'); // its asset is gone
    expect(unwrap(await store.get(doc.id)).summary.revision).toBe(2); // nothing changed
  });

  it('takes an auto version at create and every 10 minutes of edits, skipping identical ones', async () => {
    const clock = fakeClock();
    const db = openTestDb({ file: false, clock: clock.now });
    const store = createTimelineStore(db);
    const { project, assets } = seed(db);
    const doc = timeline(project.id, assets);
    unwrap(await store.create(doc));
    const autos = () => unwrap(store.versions.list(doc.id)).items.map((v) => [v.number, v.kind, v.revision]);
    expect(autos()).toEqual([[1, 'auto', 1]]);
    unwrap(await store.put(edited(doc, 61), 1));
    clock.advance(AUTO_VERSION_INTERVAL_MS - 1);
    unwrap(await store.put(edited(doc, 62), 2));
    expect(autos()).toHaveLength(1); // within 10 minutes
    clock.advance(1);
    unwrap(await store.put(edited(doc, 63), 3));
    expect(autos()).toEqual([
      [2, 'auto', 4],
      [1, 'auto', 1],
    ]);
    clock.advance(AUTO_VERSION_INTERVAL_MS);
    unwrap(await store.put(edited(doc, 63), 4)); // same content as version 2: skipped
    expect(autos()).toHaveLength(2);
  });

  it(`keeps the newest ${AUTO_VERSIONS_KEPT} autos, and every named version`, async () => {
    const clock = fakeClock();
    const db = openTestDb({ file: false, clock: clock.now });
    const store = createTimelineStore(db);
    const { project, assets } = seed(db);
    const doc = timeline(project.id, assets);
    unwrap(await store.create(doc));
    unwrap(store.versions.snapshot({ timelineId: doc.id, kind: 'named', label: 'First cut' }));
    for (let revision = 1; revision <= AUTO_VERSIONS_KEPT + 5; revision++) {
      clock.advance(AUTO_VERSION_INTERVAL_MS);
      unwrap(await store.put(edited(doc, 20 + revision), revision));
    }
    const all = unwrap(store.versions.list(doc.id, { limit: 200 })).items;
    expect(all.filter((v) => v.kind === 'auto')).toHaveLength(AUTO_VERSIONS_KEPT);
    expect(all.find((v) => v.kind === 'named')?.label).toBe('First cut');
    expect(all[0]!.revision).toBe(AUTO_VERSIONS_KEPT + 6);
    expect(unwrap(store.versions.pruneAutos())).toBe(0);
  });

  it('refuses an invalid document or a move to another project', async () => {
    const db = tickingDb();
    const store = createTimelineStore(db);
    const { project, assets } = seed(db);
    const doc = timeline(project.id, assets);
    const bad = { ...doc, tracks: [] } as unknown as Timeline;
    const refused = await store.create(bad);
    expect(!refused.ok && refused.error.code).toBe('core.validation');
    const orphan = await store.create(timeline(newId<'Project'>(), assets));
    expect(!orphan.ok && orphan.error.code).toBe('core.not_found');
    unwrap(await store.create(doc));
    const moved = await store.put({ ...doc, projectId: seed(db, 'Other').project.id }, 1);
    expect(!moved.ok && moved.error.code).toBe('core.validation');
  });

  it('stages a put with the command: it commits with the audit row, and a stale one fails the command', async () => {
    const db = tickingDb();
    const commands = createCommandUnitOfWork(db);
    const store = createTimelineStore(db, { commands });
    const { project, assets } = seed(db);
    const doc = timeline(project.id, assets);
    unwrap(await store.create(doc));
    const trim = defineCommand({
      name: 'timeline.trimClip',
      payload: z.object({ projectId: idSchema<'Project'>(), frames: z.int(), expected: z.int() }),
      sideEffect: 'write',
      handle: commands.handle(async ({ frames, expected }, context) => {
        const put = await store.put(edited(doc, frames), expected, context);
        if (!put.ok) return put;
        expect(unwrap(await store.get(doc.id)).summary.revision).toBe(expected); // not yet written
        return ok({ result: put.value.revision });
      }),
    });
    const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
    bus.register(trim);
    const ui = { source: 'ui' as const, actor: 'user' };
    expect(
      unwrap(await bus.dispatch(trim, { projectId: project.id, frames: 40, expected: 1 }, ui)).result,
    ).toBe(2);
    expect(unwrap(await store.get(doc.id)).summary.duration.value).toBe(130);
    const stale = await bus.dispatch(trim, { projectId: project.id, frames: 20, expected: 1 }, ui);
    expect(!stale.ok && stale.error.code).toBe('core.conflict');
    expect(unwrap(createRepositories(db).auditLog.listByProject(project.id))).toHaveLength(1);
  });
});
