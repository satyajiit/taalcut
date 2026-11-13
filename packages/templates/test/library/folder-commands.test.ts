// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Template folder commands (P3-V14): one undo restores the folder and its template ids. */
import { describe, expect, it } from 'vitest';
import { newId, TEMPLATE_COMMANDS, TEMPLATE_FOLDER_COMMANDS } from '@taalcut/core';
import { createFolderCommands } from '../../src/library/folder-commands';
import { createMetadataCommands } from '../../src/library/metadata-commands';
import { createMemoryFolderStore } from '../../src/testing/memory-folder-store';
import { referenceTemplate } from '../helpers/fixtures';
import { readField, unwrap } from '../helpers/result';
import { setupTemplates, UI } from '../helpers/setup';

const F = TEMPLATE_FOLDER_COMMANDS;

function foldersOf() {
  const setup = setupTemplates();
  const folders = createMemoryFolderStore(setup.clock, setup.store);
  setup.bus.register(...createFolderCommands({ folders }).all);
  setup.bus.register(...createMetadataCommands({ store: setup.store, folders, libraryMetadata: true }).all);
  return { ...setup, folders };
}

describe('template folder commands', () => {
  it('creates and renames, refuses a name that differs only by case, and undoes', async () => {
    const { bus, folders } = foldersOf();
    const folderId = newId<'TemplateFolder'>();
    const created = await bus.dispatch(F.create, { projectId: null, folderId, name: 'Trips' }, UI);
    expect(created.ok ? readField(created.value.result, 'name') : '').toBe('Trips');
    const taken = await bus.dispatch(
      F.create,
      { projectId: null, folderId: newId<'TemplateFolder'>(), name: 'trips' },
      UI,
    );
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.error.code).toBe('templates.folder_name_taken');
    const same = await bus.dispatch(F.rename, { projectId: null, folderId, name: 'Trips' }, UI);
    expect(same.ok).toBe(true);
    const renamed = await bus.dispatch(F.rename, { projectId: null, folderId, name: 'Holidays' }, UI);
    expect(renamed.ok ? readField(renamed.value.result, 'name') : '').toBe('Holidays');
    expect((await bus.undo(null, UI)).ok).toBe(true);
    const listed = await folders.list();
    expect(listed.ok ? listed.value.map((folder) => folder.name) : []).toEqual(['Trips']);
    expect((await bus.redo(null, UI)).ok).toBe(true);
    const afterRedo = await folders.list();
    expect(afterRedo.ok ? afterRedo.value[0]?.name : undefined).toBe('Holidays');
    expect((await bus.undo(null, UI)).ok).toBe(true);
    expect((await bus.undo(null, UI)).ok).toBe(true);
    expect((await bus.undo(null, UI)).ok).toBe(true);
    const emptied = await folders.list();
    expect(emptied.ok ? emptied.value : null).toEqual([]);
    expect((await bus.redo(null, UI)).ok).toBe(true);
    const missing = await bus.dispatch(
      F.rename,
      { projectId: null, folderId: newId<'TemplateFolder'>(), name: 'Nope' },
      UI,
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('templates.folder_not_found');
  });

  it('delete moves templates out and undo puts the folder and those ids back', async () => {
    const { bus, folders, store, projectA } = foldersOf();
    const template = referenceTemplate();
    expect(
      (
        await bus.dispatch(
          TEMPLATE_COMMANDS.create,
          { projectId: projectA, template, name: 'Goa', listed: true },
          UI,
        )
      ).ok,
    ).toBe(true);
    const folderId = newId<'TemplateFolder'>();
    const created = await bus.dispatch(F.create, { projectId: null, folderId, name: 'Trips' }, UI);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const createdAt = readField(created.value.result, 'createdAt');
    expect(
      (
        await bus.dispatch(
          TEMPLATE_COMMANDS.moveToFolder,
          { projectId: null, templateIds: [template.id], folderId },
          UI,
        )
      ).ok,
    ).toBe(true);
    const removed = await bus.dispatch(F.remove, { projectId: null, folderId }, UI);
    expect(removed.ok ? readField(removed.value.result, 'templateIds') : []).toEqual([template.id]);
    expect(unwrap(await store.get(template.id)).summary.folderId).toBeNull();
    expect(unwrap(await folders.list())).toEqual([]);
    expect((await bus.undo(null, UI)).ok).toBe(true);
    const listed = await folders.list();
    expect(listed.ok ? listed.value : []).toEqual([{ id: folderId, name: 'Trips', templates: 1, createdAt }]);
    expect(unwrap(await store.get(template.id)).summary.folderId).toBe(folderId);
    expect((await bus.redo(null, UI)).ok).toBe(true);
    expect(unwrap(await store.get(template.id)).summary.folderId).toBeNull();
  });
});
