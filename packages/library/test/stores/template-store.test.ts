// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P2-T8: the template store. Immutable versions with a head, findChild for
 * redo, usedBy, staged writes, content-addressed assets and search; the
 * port's semantics are pinned by templateStoreContract.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createCommandBus,
  defineCommand,
  idSchema,
  ok,
  systemClock,
  unwrap,
  type TemplateStore,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createCommandUnitOfWork, createTemplateStore, createTimelineStore } from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';
import { nextVersion, seed, template, timeline } from './documents';
import { templateStoreContract } from './template-store-contract';

const change = { command: 'template.slot.editIntent', source: 'ui' as const, changeKey: 'k'.repeat(64) };

templateStoreContract('library TemplateStore', () => {
  const db = openTestDb({ file: false });
  return createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
});

describe('template store (library)', () => {
  it('lists by search, project, fingerprint, listing and archive, newest first, in pages', async () => {
    const clock = fakeClock();
    const db = openTestDb({ file: false, clock: clock.now });
    const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
    const { project } = seed(db);
    const made = [];
    for (const [index, name] of ['Goa sunset reel', 'Delhi food walk', 'Beach day vlog'].entries()) {
      clock.advance(1000);
      const doc =
        index === 1
          ? template({
              fingerprint: '1'.repeat(64),
              overlay: 'चाट और समोसा',
              intents: ['market crowd', 'street food', 'night lights'],
            })
          : template({ fingerprint: String(index).repeat(64), overlay: 'Day 1' });
      made.push(
        unwrap(await store.create(doc, { name, projectId: index === 0 ? project.id : null, listed: true })),
      );
    }
    const names = async (query: Parameters<TemplateStore['list']>[0]) =>
      unwrap(await store.list(query)).items.map((t) => t.name);
    const base = { includeUnlisted: false, includeArchived: false, limit: 50 };
    expect(await names(base)).toEqual(['Beach day vlog', 'Delhi food walk', 'Goa sunset reel']);
    expect(await names({ ...base, query: 'sun' })).toEqual(['Beach day vlog', 'Goa sunset reel']); // name or intent
    expect(await names({ ...base, query: 'समोसा' })).toEqual(['Delhi food walk']); // overlay, Devanagari
    expect(await names({ ...base, query: 'goa reel' })).toEqual(['Goa sunset reel']); // every word
    expect(await names({ ...base, query: '"; DROP' })).toEqual([]);
    expect(await names({ ...base, projectId: project.id })).toEqual(['Goa sunset reel']);
    expect(await names({ ...base, fingerprint: '1'.repeat(64) })).toEqual(['Delhi food walk']);
    unwrap(await store.setMeta(made[1]!.id, { archived: true }));
    unwrap(await store.setMeta(made[2]!.id, { listed: false }));
    expect(await names(base)).toEqual(['Goa sunset reel']);
    expect(await names({ ...base, includeArchived: true, includeUnlisted: true })).toHaveLength(3);
    const first = unwrap(
      await store.list({ ...base, includeArchived: true, includeUnlisted: true, limit: 2 }),
    );
    expect(first.items).toHaveLength(2);
    const second = unwrap(
      await store.list({
        ...base,
        includeArchived: true,
        includeUnlisted: true,
        limit: 2,
        cursor: first.nextCursor!,
      }),
    );
    expect([...first.items, ...second.items].map((t) => t.name).sort()).toEqual([
      'Beach day vlog',
      'Delhi food walk',
      'Goa sunset reel',
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('search follows the head and the name', async () => {
    const db = openTestDb({ file: false });
    const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
    const v1 = template();
    unwrap(await store.create(v1, { name: 'Trip', projectId: null, listed: true }));
    const find = async (query: string) =>
      unwrap(await store.list({ query, includeUnlisted: true, includeArchived: true, limit: 10 })).items
        .length;
    unwrap(await store.addVersion(nextVersion(v1, 2, 1, 'skateboard trick'), change));
    expect([await find('skateboard'), await find('sunset')]).toEqual([1, 0]);
    unwrap(await store.setHead({ templateId: v1.id, version: 1, expectedHead: 2 }));
    expect([await find('skateboard'), await find('sunset')]).toEqual([0, 1]);
    unwrap(await store.setMeta(v1.id, { name: 'Monsoon' }));
    expect([await find('monsoon'), await find('trip')]).toEqual([1, 0]);
  });

  it('counts timelines in any project that use a template', async () => {
    const db = openTestDb({ file: false });
    const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
    const timelines = createTimelineStore(db);
    const doc = template();
    unwrap(await store.create(doc, { name: 'Trip', projectId: null, listed: true }));
    expect(unwrap(await store.usedBy(doc.id))).toBe(0);
    for (const name of ['One', 'Two']) {
      const { project, assets } = seed(db, name);
      unwrap(await timelines.create(timeline(project.id, assets, { template: { id: doc.id, version: 1 } })));
    }
    expect(unwrap(await store.usedBy(doc.id))).toBe(2);
  });

  it('stores assets by content, durably, and keeps those a version uses', async () => {
    const clock = fakeClock();
    const db = openTestDb({ file: false, clock: clock.now });
    const dir = join(tempDir(), 'assets');
    const store = createTemplateStore(db, { assetsDir: dir });
    const bytes = new TextEncoder().encode('jpeg bytes');
    const put = unwrap(await store.putAsset(bytes, 'image/jpeg'));
    expect(unwrap(await store.putAsset(bytes, 'image/jpeg'))).toEqual(put); // same content, same asset
    const path = unwrap(await store.assetPath(put.sha256));
    expect(path).toBe(join(dir, put.sha256.slice(0, 2), put.sha256));
    expect((await store.putAsset(new Uint8Array(), 'image/jpeg')).ok).toBe(false);
    expect((await store.putAsset(bytes, 'image/png' as 'image/jpeg')).ok).toBe(false);
    expect((await store.assetPath('../etc')).ok).toBe(false);

    const unused = unwrap(await store.putAsset(new TextEncoder().encode('abandoned'), 'image/webp'));
    const doc = template({ sheet: put.sha256 });
    unwrap(await store.create(doc, { name: 'Trip', projectId: null, listed: true }));
    clock.advance(8 * 24 * 3600_000);
    expect(unwrap(store.pruneAssets())).toBe(1); // only the unused one, after 7 days
    expect((await store.assetPath(unused.sha256)).ok).toBe(false);
    expect(existsSync(path)).toBe(true);
    unwrap(await store.remove(doc.id));
    expect((await store.assetPath(put.sha256)).ok).toBe(false); // no version uses it any more
  });

  it('remove keeps an asset another template still uses', async () => {
    const db = openTestDb({ file: false });
    const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
    const sheet = unwrap(await store.putAsset(new TextEncoder().encode('sheet'), 'image/jpeg')).sha256;
    const a = template({ sheet });
    const b = template({ sheet });
    unwrap(await store.create(a, { name: 'A', projectId: null, listed: true }));
    unwrap(await store.create(b, { name: 'B', projectId: null, listed: true }));
    unwrap(await store.remove(a.id));
    expect((await store.assetPath(sheet)).ok).toBe(true);
  });

  it('stages writes on the command unit of work: they commit with the audit row, or not at all', async () => {
    const db = openTestDb({ file: false });
    const commands = createCommandUnitOfWork(db);
    const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets'), commands });
    const doc = template();
    const create = defineCommand({
      name: 'template.create',
      payload: z.object({ templateId: idSchema<'Template'>() }),
      sideEffect: 'write',
      handle: commands.handle(async (_payload, context) => {
        const made = await store.create(doc, { name: 'Staged', projectId: null, listed: true }, context);
        if (!made.ok) return made;
        // Staged, so not yet visible to the handler itself.
        expect((await store.get(doc.id)).ok).toBe(false);
        return ok({ result: made.value });
      }),
    });
    const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
    bus.register(create);
    unwrap(await bus.dispatch(create, { templateId: doc.id }, { source: 'ui', actor: 'user' }));
    expect(unwrap(await store.get(doc.id)).summary.name).toBe('Staged');
    // A second create of the same id fails at check time, before anything is staged.
    const again = await bus.dispatch(create, { templateId: doc.id }, { source: 'ui', actor: 'user' });
    expect(!again.ok && again.error.code).toBe('core.conflict');
  });
});
