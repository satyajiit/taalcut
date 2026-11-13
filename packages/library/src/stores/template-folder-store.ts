// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's TemplateFolderStore (P3-V14) over migration 20's `template_folders`. A template's folder is its
 * `templates.folder_id`; a folder's count is every template in it, listed or not. Names are unique by
 * `name_key` (NFC, lower case). Deleting a folder moves its templates to no folder and returns their ids;
 * restore (the delete's inverse) puts the folder and those templates back. Moving templates in or out stamps
 * them changed, as `setMeta` does. Writes given a CommandContext are staged on the command's unit of work.
 */
import {
  ConflictError,
  err,
  ok,
  type Result,
  type TemplateFolder,
  type TemplateFolderId,
  type TemplateFolderStore,
  type TemplateId,
  ValidationError,
} from '@taalcut/core';
import { and, asc, count, eq, inArray, ne } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { templateFolders, templates } from '../schema/templates';
import { cleanText } from './canonical';
import { stagedWriter } from './staged-write';
import { folderNameKey, folderNameTaken, folderNotFound } from './template-folder-errors';

type FolderRow = typeof templateFolders.$inferSelect;

export interface TemplateFolderStoreOptions {
  /** createLibraryPorts(db).commands: writes with a context commit with the command's audit row. */
  readonly commands?: CommandStager;
}

function folderName(name: string): Result<string> {
  const clean = cleanText(name);
  return clean && clean.length <= 60 ? ok(clean) : err(ValidationError({ field: 'name' }));
}

export function createTemplateFolderStore(
  db: LibraryDatabase,
  options: TemplateFolderStoreOptions = {},
): TemplateFolderStore {
  const { orm } = db;
  const write = stagedWriter(db, options.commands, 'template_folder');
  const folder = (id: TemplateFolderId) =>
    orm.select().from(templateFolders).where(eq(templateFolders.id, id)).get();
  const templatesIn = (id: TemplateFolderId): TemplateId[] =>
    orm
      .select({ id: templates.id })
      .from(templates)
      .where(eq(templates.folderId, id))
      .orderBy(asc(templates.id))
      .all()
      .map((row) => row.id);
  const taken = (key: string, except?: TemplateFolderId) =>
    orm
      .select({ id: templateFolders.id })
      .from(templateFolders)
      .where(and(eq(templateFolders.nameKey, key), except ? ne(templateFolders.id, except) : undefined))
      .get() !== undefined;
  const view = (row: FolderRow, size: number): TemplateFolder => ({
    id: row.id,
    name: row.name,
    templates: size,
    createdAt: row.createdAt,
  });

  /** Moves these templates (those that still exist) into `folderId`, or out with null. */
  function move(ids: readonly TemplateId[], folderId: TemplateFolderId | null): void {
    if (ids.length === 0) return;
    orm
      .update(templates)
      .set({ folderId, updatedAt: db.clock() })
      .where(inArray(templates.id, [...ids]))
      .run();
  }

  return {
    async list() {
      const sizes = new Map(
        orm
          .select({ folderId: templates.folderId, n: count() })
          .from(templates)
          .groupBy(templates.folderId)
          .all()
          .map((row) => [row.folderId, row.n]),
      );
      const rows = orm
        .select()
        .from(templateFolders)
        .orderBy(asc(templateFolders.createdAt), asc(templateFolders.id))
        .all();
      return ok(rows.map((row) => view(row, sizes.get(row.id) ?? 0)));
    },

    async create(input, context) {
      const name = folderName(input.name);
      if (!name.ok) return name;
      const row: FolderRow = {
        id: input.id,
        name: name.value,
        nameKey: folderNameKey(name.value),
        createdAt: db.clock(),
      };
      const check = (): Result<void> => {
        if (folder(input.id)) return err(ConflictError({ entity: 'templateFolder', id: input.id }));
        return taken(row.nameKey) ? err(folderNameTaken()) : ok(undefined);
      };
      const saved = write(context, check, () => {
        orm.insert(templateFolders).values(row).run();
      });
      return saved.ok ? ok(view(row, 0)) : saved;
    },

    async rename(id, name, context) {
      const before = folder(id);
      if (!before) return err(folderNotFound());
      const clean = folderName(name);
      if (!clean.ok) return clean;
      const changes = { name: clean.value, nameKey: folderNameKey(clean.value) };
      const check = (): Result<void> => {
        if (!folder(id)) return err(folderNotFound());
        return taken(changes.nameKey, id) ? err(folderNameTaken()) : ok(undefined);
      };
      const saved = write(context, check, () => {
        orm.update(templateFolders).set(changes).where(eq(templateFolders.id, id)).run();
      });
      return saved.ok ? ok(view({ ...before, ...changes }, templatesIn(id).length)) : saved;
    },

    async remove(id, context) {
      if (!folder(id)) return err(folderNotFound());
      const templateIds = templatesIn(id);
      const check = () => (folder(id) ? ok(undefined) : err(folderNotFound()));
      const saved = write(context, check, () => {
        // Inside the commit, so a template filed since the check also leaves the folder.
        move(templatesIn(id), null);
        orm.delete(templateFolders).where(eq(templateFolders.id, id)).run();
      });
      return saved.ok ? ok({ templateIds }) : saved;
    },

    async restore(input, templateIds, context) {
      const name = folderName(input.name);
      if (!name.ok) return name;
      const row: FolderRow = {
        id: input.id,
        name: name.value,
        nameKey: folderNameKey(name.value),
        createdAt: input.createdAt,
      };
      const check = () => (taken(row.nameKey, row.id) ? err(folderNameTaken()) : ok(undefined));
      const saved = write(context, check, () => {
        orm
          .insert(templateFolders)
          .values(row)
          .onConflictDoUpdate({ target: templateFolders.id, set: { name: row.name, nameKey: row.nameKey } })
          .run();
        move(templateIds, row.id);
      });
      return saved.ok ? ok(view(row, templateIds.length)) : saved;
    },
  };
}
