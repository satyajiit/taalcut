// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * In-memory template folders (P3-V14). Membership lives on the template store's `folderId`;
 * delete moves those templates out and restore puts the same ids back. Names are unique
 * case-insensitively.
 */
import {
  ConflictError,
  err,
  ok,
  type AsyncResult,
  type Clock,
  type CommandContext,
  type TemplateFolder,
  type TemplateFolderId,
  type TemplateFolderStore,
  type TemplateId,
  type TemplateStore,
} from '@taalcut/core';
import { FolderNameTaken, FolderNotFound } from '../errors';

type Templates = Pick<TemplateStore, 'list' | 'setMeta'>;

interface FolderRow {
  readonly id: TemplateFolderId;
  name: string;
  readonly createdAt: number;
}

const sameName = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'accent' }) === 0;

async function idsIn(templates: Templates, folderId: TemplateFolderId): AsyncResult<TemplateId[]> {
  const ids: TemplateId[] = [];
  let cursor: string | undefined;
  do {
    const page = await templates.list({
      folderId,
      includeUnlisted: true,
      includeArchived: true,
      limit: 200,
      cursor,
    });
    if (!page.ok) return page;
    ids.push(...page.value.items.map((item) => item.id));
    cursor = page.value.nextCursor ?? undefined;
  } while (cursor);
  return ok(ids);
}

export function createMemoryFolderStore(clock: Clock, templates: Templates): TemplateFolderStore {
  const folders = new Map<TemplateFolderId, FolderRow>();

  const taken = (name: string, except?: TemplateFolderId) =>
    [...folders.values()].some((folder) => folder.id !== except && sameName(folder.name, name));

  async function summarise(folder: FolderRow): AsyncResult<TemplateFolder> {
    const ids = await idsIn(templates, folder.id);
    if (!ids.ok) return ids;
    return ok({ id: folder.id, name: folder.name, templates: ids.value.length, createdAt: folder.createdAt });
  }

  return {
    async list() {
      const rows = [...folders.values()].sort((a, b) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : 1));
      const items: TemplateFolder[] = [];
      for (const row of rows) {
        const item = await summarise(row);
        if (!item.ok) return item;
        items.push(item.value);
      }
      return ok(items);
    },

    async create(input, _context?: CommandContext): AsyncResult<TemplateFolder> {
      if (folders.has(input.id)) return err(ConflictError({ entity: 'templateFolder', id: input.id }));
      if (taken(input.name)) return err(FolderNameTaken());
      const row: FolderRow = { id: input.id, name: input.name, createdAt: clock.now() };
      folders.set(row.id, row);
      return summarise(row);
    },

    async rename(id, name, _context?: CommandContext) {
      const row = folders.get(id);
      if (!row) return err(FolderNotFound());
      if (taken(name, id)) return err(FolderNameTaken());
      row.name = name;
      return summarise(row);
    },

    async remove(id, context) {
      const row = folders.get(id);
      if (!row) return err(FolderNotFound());
      const found = await idsIn(templates, id);
      if (!found.ok) return found;
      const templateIds = found.value;
      for (const templateId of templateIds) {
        const cleared = await templates.setMeta(templateId, { folderId: null }, context);
        if (!cleared.ok) return cleared;
      }
      folders.delete(id);
      return ok({ templateIds });
    },

    async restore(folder, templateIds, context) {
      if (taken(folder.name, folder.id)) return err(FolderNameTaken());
      const row: FolderRow = folders.get(folder.id) ?? {
        id: folder.id,
        name: folder.name,
        createdAt: folder.createdAt,
      };
      row.name = folder.name;
      folders.set(folder.id, row);
      for (const templateId of templateIds) {
        const moved = await templates.setMeta(templateId, { folderId: folder.id }, context);
        if (!moved.ok) return moved;
      }
      return ok({ id: row.id, name: row.name, templates: templateIds.length, createdAt: row.createdAt });
    },
  };
}
