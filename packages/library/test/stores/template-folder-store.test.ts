// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * P3-V14: template folders. Names are unique case-insensitively in any script; a folder counts every template
 * in it; delete moves its templates out and returns their ids, and restore (its inverse) puts both back.
 */
import { join } from 'node:path';
import {
  createCommandBus,
  defineCommand,
  err,
  idSchema,
  newId,
  ok,
  systemClock,
  UnknownError,
  unwrap,
  type TemplateFolderStore,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createCommandUnitOfWork, createTemplateFolderStore, createTemplateStore } from '../../src/index';
import { fakeClock, openTestDb, tempDir } from '../helpers';
import { template } from './documents';

function setup() {
  const clock = fakeClock();
  const db = openTestDb({ file: false, clock: clock.now });
  const store = createTemplateStore(db, { assetsDir: join(tempDir(), 'assets') });
  return { clock, db, store, folders: createTemplateFolderStore(db) };
}

const code = (result: { ok: boolean; error?: { code: string } }) => (result.ok ? 'ok' : result.error?.code);

describe('template folder store (P3-V14)', () => {
  it('creates, lists with counts in creation order, and renames', async () => {
    const { clock, store, folders } = setup();
    const travel = newId<'TemplateFolder'>();
    const food = newId<'TemplateFolder'>();
    expect(unwrap(await folders.create({ id: travel, name: ' Travel ' }))).toMatchObject({
      id: travel,
      name: 'Travel',
      templates: 0,
    });
    clock.advance(10);
    unwrap(await folders.create({ id: food, name: 'Food' }));
    for (const listed of [true, false]) {
      const doc = template();
      unwrap(await store.create(doc, { name: 'In travel', projectId: null, listed }));
      unwrap(await store.setMeta(doc.id, { folderId: travel }));
    }
    const listed = unwrap(await folders.list());
    expect(listed.map((folder) => [folder.name, folder.templates])).toEqual([
      ['Travel', 2],
      ['Food', 0],
    ]);
    expect(unwrap(await folders.rename(food, 'Street food'))).toMatchObject({ name: 'Street food' });
    expect(unwrap(await folders.rename(travel, 'TRAVEL'))).toMatchObject({ name: 'TRAVEL', templates: 2 });
    expect(code(await folders.rename(newId<'TemplateFolder'>(), 'X'))).toBe('templates.folder_not_found');
  });

  it('refuses a name another folder has, in any case and script', async () => {
    const { folders } = setup();
    const ete = newId<'TemplateFolder'>();
    unwrap(await folders.create({ id: ete, name: 'Été à Goa' }));
    unwrap(await folders.create({ id: newId<'TemplateFolder'>(), name: 'Reels' }));
    for (const name of ['été À goa', 'REELS', 'reels ']) {
      expect(code(await folders.create({ id: newId<'TemplateFolder'>(), name }))).toBe(
        'templates.folder_name_taken',
      );
    }
    expect(code(await folders.rename(ete, 'reels'))).toBe('templates.folder_name_taken');
    expect(code(await folders.create({ id: ete, name: 'Other' }))).toBe('core.conflict');
    expect(code(await folders.create({ id: newId<'TemplateFolder'>(), name: '   ' }))).toBe(
      'core.validation',
    );
    expect(code(await folders.create({ id: newId<'TemplateFolder'>(), name: 'Ete a Goa' }))).toBe('ok');
  });

  it('delete moves its templates out; restore puts the folder and them back', async () => {
    const { store, folders } = setup();
    const travel = newId<'TemplateFolder'>();
    const created = unwrap(await folders.create({ id: travel, name: 'Travel' }));
    const docs = [template(), template(), template()];
    for (const [index, doc] of docs.entries()) {
      unwrap(await store.create(doc, { name: `T${index}`, projectId: null, listed: true }));
      if (index < 2) unwrap(await store.setMeta(doc.id, { folderId: travel }));
    }
    const { templateIds } = unwrap(await folders.remove(travel));
    expect([...templateIds].sort()).toEqual([docs[0]?.id, docs[1]?.id].sort());
    expect(unwrap(await folders.list())).toEqual([]);
    const page = unwrap(await store.list({ includeUnlisted: true, includeArchived: true, limit: 10 }));
    expect(page.items.every((item) => item.folderId === null)).toBe(true);
    expect(code(await folders.remove(travel))).toBe('templates.folder_not_found');

    unwrap(await store.remove(docs[1]?.id ?? newId<'Template'>())); // gone before the undo
    const restored = unwrap(await folders.restore(created, templateIds));
    expect(restored).toMatchObject({ id: travel, name: 'Travel', createdAt: created.createdAt });
    expect(unwrap(await folders.list())).toMatchObject([{ id: travel, templates: 1 }]);
    expect(
      unwrap(await store.list({ includeUnlisted: true, includeArchived: true, limit: 10, folderId: travel })),
    ).toMatchObject({ items: [{ id: docs[0]?.id }] });
  });

  it('stages writes with a command context: nothing lands unless the command commits', async () => {
    const db = openTestDb({ file: false });
    const commands = createCommandUnitOfWork(db);
    const folders: TemplateFolderStore = createTemplateFolderStore(db, { commands });
    const id = newId<'TemplateFolder'>();
    const create = defineCommand({
      name: 'templateFolder.create',
      payload: z.object({ folderId: idSchema<'TemplateFolder'>(), fail: z.boolean() }),
      sideEffect: 'write',
      handle: commands.handle(async ({ folderId, fail }, context) => {
        const made = await folders.create({ id: folderId, name: 'Staged' }, context);
        if (!made.ok) return made;
        expect(unwrap(await folders.list())).toEqual([]);
        return fail ? err(UnknownError()) : ok({ result: made.value });
      }),
    });
    const bus = createCommandBus({ store: commands.auditLog, clock: systemClock });
    bus.register(create);
    expect(
      (await bus.dispatch(create, { folderId: id, fail: true }, { source: 'ui', actor: 'user' })).ok,
    ).toBe(false);
    expect(unwrap(await folders.list())).toEqual([]);
    unwrap(await bus.dispatch(create, { folderId: id, fail: false }, { source: 'ui', actor: 'user' }));
    expect(unwrap(await folders.list())).toMatchObject([{ id, name: 'Staged' }]);
  });
});
