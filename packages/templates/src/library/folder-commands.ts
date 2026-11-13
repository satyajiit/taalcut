// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template folder commands (P3-V14). Delete moves the folder's templates out; its inverse,
 * `templateFolder.restore`, puts the folder and those template ids back.
 */
import {
  defineCommand,
  err,
  ok,
  TEMPLATE_FOLDER_COMMANDS,
  templateFolderCommandPayloads,
  type AnyCommand,
  type TemplateFolderStore,
} from '@taalcut/core';
import { FolderNotFound } from '../errors';

const N = TEMPLATE_FOLDER_COMMANDS;
const P = templateFolderCommandPayloads;

export function createFolderCommands(deps: { readonly folders: TemplateFolderStore }) {
  const { folders } = deps;

  const create = defineCommand({
    name: N.create,
    payload: P[N.create],
    sideEffect: 'write',
    handle: async ({ folderId, name }, context) => {
      const created = await folders.create({ id: folderId, name }, context);
      if (!created.ok) return created;
      return ok({
        result: created.value,
        inverse: { name: N.remove, payload: { projectId: null, folderId } },
      });
    },
  });

  const rename = defineCommand({
    name: N.rename,
    payload: P[N.rename],
    sideEffect: 'write',
    handle: async ({ folderId, name }, context) => {
      const listed = await folders.list();
      if (!listed.ok) return listed;
      const before = listed.value.find((folder) => folder.id === folderId);
      if (!before) return err(FolderNotFound());
      const renamed = await folders.rename(folderId, name, context);
      if (!renamed.ok) return renamed;
      return ok({
        result: renamed.value,
        inverse: { name: N.rename, payload: { projectId: null, folderId, name: before.name } },
      });
    },
  });

  const remove = defineCommand({
    name: N.remove,
    payload: P[N.remove],
    sideEffect: 'write',
    handle: async ({ folderId }, context) => {
      const listed = await folders.list();
      if (!listed.ok) return listed;
      const before = listed.value.find((folder) => folder.id === folderId);
      if (!before) return err(FolderNotFound());
      const removed = await folders.remove(folderId, context);
      if (!removed.ok) return removed;
      return ok({
        result: { folderId, templateIds: removed.value.templateIds },
        inverse: {
          name: N.restore,
          payload: {
            projectId: null,
            folder: { id: folderId, name: before.name, createdAt: before.createdAt },
            templateIds: removed.value.templateIds,
          },
        },
      });
    },
  });

  const restore = defineCommand({
    name: N.restore,
    payload: P[N.restore],
    sideEffect: 'write',
    internal: true,
    handle: async ({ folder, templateIds }, context) => {
      const restored = await folders.restore(folder, templateIds, context);
      return restored.ok ? ok({ result: restored.value }) : restored;
    },
  });

  const all: AnyCommand[] = [create, rename, remove, restore];
  return { create, rename, remove, restore, all };
}
