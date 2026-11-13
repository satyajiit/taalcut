// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Who belongs to a style profile's source set (LRN1-STY), read from the library's own tables: the templates linked
 * to a Saved collection's Reels (every saved Reel for `all_saved`), filed in a folder, carrying a tag, or cast into a
 * timeline with a finished export. Always unarchived templates at their heads; the newest STYLE_PROFILE_MAX_MEMBERS
 * (by creation), returned in id order.
 */
import {
  ALL_SAVED_COLLECTION_ID,
  err,
  NotFoundError,
  ok,
  STYLE_PROFILE_MAX_MEMBERS,
  type Result,
  type StyleSource,
  type TemplateRef,
} from '@taalcut/core';
import { and, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { instagramCollections, instagramSavedReels } from '../schema/instagram';
import { renders, timelines } from '../schema/projects';
import { templateFolders, templates } from '../schema/templates';

/** The collection's or folder's name, the tag, or null for my exports; core.not_found when the set is gone. */
/** A looked-up row's name, or core.not_found for the entity when there was none. */
const nameOr = (row: { name: string } | undefined, entity: string, id: string): Result<string> =>
  row ? ok(row.name) : err(NotFoundError({ entity, id }));

export function styleSourceName(db: LibraryDatabase, source: StyleSource): Result<string | null> {
  const { orm } = db;
  switch (source.kind) {
    case 'instagram-collection': {
      const { collectionId } = source;
      const table = instagramCollections;
      const row = orm.select({ name: table.name }).from(table).where(eq(table.id, collectionId)).get();
      return nameOr(row, 'instagramCollection', collectionId);
    }
    case 'folder': {
      const table = templateFolders;
      const row = orm.select({ name: table.name }).from(table).where(eq(table.id, source.folderId)).get();
      return nameOr(row, 'templateFolder', source.folderId);
    }
    case 'tag':
      return ok(source.tag);
    case 'my-exports':
      return ok(null);
  }
}

/** The condition that puts a template in the set. */
function membership(db: LibraryDatabase, source: StyleSource): SQL | undefined {
  const { orm } = db;
  switch (source.kind) {
    case 'instagram-collection': {
      const linked = isNotNull(instagramSavedReels.templateId);
      const reels = orm
        .select({ id: instagramSavedReels.templateId })
        .from(instagramSavedReels)
        .where(
          source.collectionId === ALL_SAVED_COLLECTION_ID
            ? linked
            : and(linked, eq(instagramSavedReels.collectionId, source.collectionId)),
        );
      return inArray(templates.id, reels);
    }
    case 'folder':
      return eq(templates.folderId, source.folderId);
    case 'tag':
      return sql`EXISTS (SELECT 1 FROM json_each(${templates.tags}) WHERE json_each.value = ${source.tag})`;
    case 'my-exports': {
      const exported = orm
        .select({ id: timelines.templateId })
        .from(timelines)
        .innerJoin(renders, eq(renders.timelineId, timelines.id))
        .where(and(eq(renders.status, 'ready'), isNull(renders.deletedAt), isNotNull(timelines.templateId)));
      return inArray(templates.id, exported);
    }
  }
}

export function styleMembers(db: LibraryDatabase, source: StyleSource): Result<TemplateRef[]> {
  // A gone collection or folder is an error, not an empty set: its profile is removed, never rebuilt empty.
  const named = styleSourceName(db, source);
  if (!named.ok) return named;
  const rows = db.orm
    .select({ id: templates.id, version: templates.headVersion })
    .from(templates)
    .where(and(isNull(templates.archivedAt), membership(db, source)))
    .orderBy(desc(templates.createdAt), desc(templates.id))
    .limit(STYLE_PROFILE_MAX_MEMBERS)
    .all();
  return ok(rows.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));
}
