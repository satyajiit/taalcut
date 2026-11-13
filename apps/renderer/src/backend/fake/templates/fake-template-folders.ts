// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template folders (P3-V14) as the templates service keeps them (packages/templates library/folder-commands.ts,
 * testing/memory-folder-store.ts): oldest first, names unique ignoring case, a count that includes archived
 * templates. Delete moves the folder's templates out; its inverse, `templateFolder.restore`, puts the folder and
 * those templates back.
 */
import {
  ConflictError,
  defineCommand,
  err,
  ok,
  TEMPLATE_FOLDER_COMMANDS,
  templateFolderCommandPayloads,
  type AnyCommand,
  type Id,
  type TemplateFolder,
} from '@taalcut/core';
import type { FakeTemplates } from './fake-templates';
import { FolderNameTaken, FolderNotFound } from './template-errors';
import { seedFolders, type SeedFolder } from './template-seed-library';

const N = TEMPLATE_FOLDER_COMMANDS;
const P = templateFolderCommandPayloads;
const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

export function createFakeFolders(templates: FakeTemplates) {
  // The library's own templates decide the folders; ones read in a chat and never saved (unlisted) don't count.
  const all = templates.summaries().filter((item) => item.listed !== false);
  const folders = new Map<Id<'TemplateFolder'>, SeedFolder>(
    all.length === 0 ? [] : seedFolders(all.length > 3).map((folder) => [folder.id, folder]),
  );
  const taken = (name: string, except?: Id<'TemplateFolder'>) =>
    [...folders.values()].some((folder) => folder.id !== except && sameName(folder.name, name));
  const idsIn = (folderId: Id<'TemplateFolder'>) =>
    templates
      .summaries()
      .filter((item) => item.folderId === folderId)
      .map((item) => item.id);
  const summarise = (folder: SeedFolder): TemplateFolder => ({
    ...folder,
    templates: idsIn(folder.id).length,
  });

  const create = defineCommand({
    name: N.create,
    payload: P[N.create],
    sideEffect: 'write',
    project: () => null,
    handle: ({ folderId, name }) => {
      if (folders.has(folderId)) return err(ConflictError({ entity: 'templateFolder', id: folderId }));
      if (taken(name)) return err(FolderNameTaken());
      const row = { id: folderId, name, createdAt: Date.now() };
      folders.set(folderId, row);
      return ok({
        result: summarise(row),
        inverse: { name: N.remove, payload: { projectId: null, folderId } },
      });
    },
  });

  const rename = defineCommand({
    name: N.rename,
    payload: P[N.rename],
    sideEffect: 'write',
    project: () => null,
    handle: ({ folderId, name }) => {
      const before = folders.get(folderId);
      if (!before) return err(FolderNotFound());
      if (taken(name, folderId)) return err(FolderNameTaken());
      const row = { ...before, name };
      folders.set(folderId, row);
      return ok({
        result: summarise(row),
        inverse: { name: N.rename, payload: { projectId: null, folderId, name: before.name } },
      });
    },
  });

  const remove = defineCommand({
    name: N.remove,
    payload: P[N.remove],
    sideEffect: 'write',
    project: () => null,
    handle: ({ folderId }) => {
      const before = folders.get(folderId);
      if (!before) return err(FolderNotFound());
      const templateIds = idsIn(folderId);
      for (const templateId of templateIds) templates.setMeta(templateId, { folderId: null }, false);
      folders.delete(folderId);
      templates.announce(templateIds);
      return ok({
        result: { folderId, templateIds },
        inverse: { name: N.restore, payload: { projectId: null, folder: before, templateIds } },
      });
    },
  });

  const restore = defineCommand({
    name: N.restore,
    payload: P[N.restore],
    sideEffect: 'write',
    internal: true,
    project: () => null,
    handle: ({ folder, templateIds }) => {
      if (taken(folder.name, folder.id)) return err(FolderNameTaken());
      const row = { ...(folders.get(folder.id) ?? folder), name: folder.name };
      folders.set(folder.id, row);
      for (const templateId of templateIds) templates.setMeta(templateId, { folderId: folder.id }, false);
      templates.announce(templateIds);
      return ok({ result: { ...row, templates: templateIds.length } });
    },
  });

  const commands: AnyCommand[] = [create, rename, remove, restore];
  return {
    commands,
    list: (): TemplateFolder[] =>
      [...folders.values()]
        .sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1))
        .map(summarise),
    has: (folderId: Id<'TemplateFolder'>) => folders.has(folderId),
  };
}

export type FakeFolders = ReturnType<typeof createFakeFolders>;
