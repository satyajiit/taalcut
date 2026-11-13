// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's InstagramSavedStore over migration 29's `instagram_collections` and
 * `instagram_saved_reels`. Writes with a CommandContext are staged on the
 * command's unit of work so undo/redo and audit rows commit atomically.
 */
import {
  ALL_SAVED_COLLECTION_ID,
  err,
  extractInstagramShortcode,
  instagramCollectionNotFoundError,
  NotFoundError,
  ok,
  type InstagramCollection,
  type InstagramReelsPage,
  type InstagramReelsQuery,
  type InstagramSavedReel,
  type InstagramSavedStore,
  type Result,
  type TemplateId,
} from '@taalcut/core';
import { and, asc, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { instagramCollections, instagramSavedReels } from '../schema/instagram';
import { templateVersions } from '../schema/templates';
import { stagedWriter } from './staged-write';

type CollectionRow = typeof instagramCollections.$inferSelect;
type ReelRow = typeof instagramSavedReels.$inferSelect;

export interface InstagramSavedStoreOptions {
  readonly commands?: CommandStager;
}

function toCollection(row: CollectionRow): InstagramCollection {
  return {
    id: row.id,
    name: row.name,
    mediaCount: row.mediaCount,
    coverUrl: row.coverUrl,
    watched: row.watched,
    autoBreakdown: row.autoBreakdown,
    lastSyncedAt: row.lastSyncedAt,
    updatedAt: row.updatedAt,
  };
}

function toReel(row: ReelRow): InstagramSavedReel {
  return {
    shortcode: row.shortcode,
    mediaPk: row.mediaPk,
    collectionId: row.collectionId,
    permalink: row.permalink,
    caption: row.caption,
    authorHandle: row.authorHandle,
    durationMs: row.durationMs,
    thumbnailUrl: row.thumbnailUrl,
    savedAt: row.savedAt,
    templateId: row.templateId,
  };
}

function parseCursor(cursor: string | undefined): { readonly savedAt: number; readonly shortcode: string } | null {
  if (!cursor) return null;
  const sep = cursor.indexOf(':');
  if (sep <= 0) return null;
  const savedAt = Number(cursor.slice(0, sep));
  const shortcode = cursor.slice(sep + 1);
  if (!Number.isInteger(savedAt) || savedAt < 0 || !shortcode) return null;
  return { savedAt, shortcode };
}

export function createInstagramSavedStore(
  db: LibraryDatabase,
  options: InstagramSavedStoreOptions = {},
): InstagramSavedStore {
  const { orm } = db;
  const write = stagedWriter(db, options.commands, 'instagram_saved');

  const findCollection = (id: string): CollectionRow | undefined =>
    orm.select().from(instagramCollections).where(eq(instagramCollections.id, id)).get();

  const findReel = (shortcode: string): ReelRow | undefined =>
    orm.select().from(instagramSavedReels).where(eq(instagramSavedReels.shortcode, shortcode)).get();

  const findTemplateByShortcode = (shortcode: string): TemplateId | null => {
    const rows = orm
      .select({ templateId: templateVersions.templateId, document: templateVersions.document })
      .from(templateVersions)
      .where(and(eq(templateVersions.version, 1), eq(templateVersions.platform, 'reels')))
      .orderBy(desc(templateVersions.createdAt))
      .all();
    for (const r of rows) {
      const url = (r.document as { origin?: { url?: unknown } } | null)?.origin?.url;
      if (typeof url === 'string' && extractInstagramShortcode(url) === shortcode) {
        return r.templateId;
      }
    }
    return null;
  };

  const selectCollections = (): InstagramCollection[] => {
    const rows = orm
      .select()
      .from(instagramCollections)
      .orderBy(
        desc(instagramCollections.watched),
        desc(instagramCollections.updatedAt),
        asc(instagramCollections.id),
      )
      .all();
    return rows
      .sort((a, b) => {
        if (a.id === ALL_SAVED_COLLECTION_ID && b.id !== ALL_SAVED_COLLECTION_ID) return -1;
        if (b.id === ALL_SAVED_COLLECTION_ID && a.id !== ALL_SAVED_COLLECTION_ID) return 1;
        return 0;
      })
      .map(toCollection);
  };

  return {
    async listCollections() {
      return ok(selectCollections());
    },

    async getCollection(collectionId) {
      const row = findCollection(collectionId);
      return ok(row ? toCollection(row) : null);
    },

    async upsertCollections(items, context) {
      const now = db.clock();
      const saved = write(
        context,
        () => ok(undefined),
        () => {
          for (const item of items) {
            const existing = findCollection(item.id);
            const lastSyncedAt =
              item.lastSyncedAt !== undefined ? item.lastSyncedAt : (existing?.lastSyncedAt ?? null);
            orm
              .insert(instagramCollections)
              .values({
                id: item.id,
                name: item.name,
                mediaCount: item.mediaCount,
                coverUrl: item.coverUrl,
                watched: existing?.watched ?? false,
                autoBreakdown: existing?.autoBreakdown ?? false,
                lastSyncedAt,
                updatedAt: now,
              })
              .onConflictDoUpdate({
                target: instagramCollections.id,
                set: {
                  name: item.name,
                  mediaCount: item.mediaCount,
                  coverUrl: item.coverUrl,
                  lastSyncedAt,
                  updatedAt: now,
                },
              })
              .run();
          }
        },
      );
      return saved.ok ? ok(selectCollections()) : saved;
    },

    async setWatch(input, context) {
      const check = (): Result<void> =>
        findCollection(input.collectionId)
          ? ok(undefined)
          : err(instagramCollectionNotFoundError({ collectionId: input.collectionId }));
      const autoBreakdown = input.watched ? input.autoBreakdown : false;
      const saved = write(context, check, () => {
        orm
          .update(instagramCollections)
          .set({
            watched: input.watched,
            autoBreakdown,
            updatedAt: db.clock(),
          })
          .where(eq(instagramCollections.id, input.collectionId))
          .run();
      });
      if (!saved.ok) return saved;
      const updated = findCollection(input.collectionId);
      return updated
        ? ok(toCollection(updated))
        : err(instagramCollectionNotFoundError({ collectionId: input.collectionId }));
    },

    async listReels(query: InstagramReelsQuery): Promise<Result<InstagramReelsPage>> {
      const limit = Math.min(Math.max(query.limit ?? 50, 1), 200);
      const conditions = [];
      if (query.collectionId && query.collectionId !== ALL_SAVED_COLLECTION_ID) {
        conditions.push(eq(instagramSavedReels.collectionId, query.collectionId));
      }
      if (query.onlyUnlinked) {
        conditions.push(isNull(instagramSavedReels.templateId));
      }
      const search = query.query?.trim();
      if (search) {
        const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        conditions.push(
          or(
            sql`${instagramSavedReels.caption} LIKE ${pattern} ESCAPE '\\'`,
            sql`${instagramSavedReels.authorHandle} LIKE ${pattern} ESCAPE '\\'`,
            sql`${instagramSavedReels.shortcode} LIKE ${pattern} ESCAPE '\\'`,
          ),
        );
      }
      const cursor = parseCursor(query.cursor);
      if (cursor) {
        conditions.push(
          or(
            lt(instagramSavedReels.savedAt, cursor.savedAt),
            and(
              eq(instagramSavedReels.savedAt, cursor.savedAt),
              lt(instagramSavedReels.shortcode, cursor.shortcode),
            ),
          ),
        );
      }

      const rows = orm
        .select()
        .from(instagramSavedReels)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(instagramSavedReels.savedAt), desc(instagramSavedReels.shortcode))
        .limit(limit + 1)
        .all();

      const hasMore = rows.length > limit;
      const pageRows = hasMore ? rows.slice(0, limit) : rows;
      const last = pageRows[pageRows.length - 1];
      return ok({
        items: pageRows.map(toReel),
        nextCursor: hasMore && last ? `${last.savedAt}:${last.shortcode}` : null,
      });
    },

    async upsertReels(items, context) {
      const addedShortcodes: string[] = [];
      const saved = write(
        context,
        () => ok(undefined),
        () => {
          addedShortcodes.length = 0;
          for (const item of items) {
            const existing = findReel(item.shortcode);
            const nextCollectionId =
              item.collectionId === ALL_SAVED_COLLECTION_ID &&
              existing &&
              existing.collectionId !== ALL_SAVED_COLLECTION_ID
                ? existing.collectionId
                : item.collectionId;
            if (!existing || existing.collectionId !== nextCollectionId) {
              addedShortcodes.push(item.shortcode);
            }
            const savedAt = existing ? existing.savedAt : item.savedAt;
            const templateId = existing?.templateId ?? findTemplateByShortcode(item.shortcode);
            orm
              .insert(instagramSavedReels)
              .values({
                shortcode: item.shortcode,
                mediaPk: item.mediaPk,
                collectionId: nextCollectionId,
                permalink: item.permalink,
                caption: item.caption,
                authorHandle: item.authorHandle,
                durationMs: item.durationMs,
                thumbnailUrl: item.thumbnailUrl,
                savedAt,
                templateId,
              })
              .onConflictDoUpdate({
                target: instagramSavedReels.shortcode,
                set: {
                  mediaPk: item.mediaPk,
                  collectionId: nextCollectionId,
                  permalink: item.permalink,
                  caption: item.caption,
                  authorHandle: item.authorHandle,
                  durationMs: item.durationMs,
                  thumbnailUrl: item.thumbnailUrl,
                  savedAt,
                  templateId,
                },
              })
              .run();
          }
        },
      );
      return saved.ok ? ok({ addedShortcodes }) : saved;
    },

    async linkTemplate(shortcode, templateId, context) {
      const before = findReel(shortcode);
      if (!before) return err(NotFoundError({ entity: 'instagramSavedReel', id: shortcode }));
      const check = (): Result<void> =>
        findReel(shortcode)
          ? ok(undefined)
          : err(NotFoundError({ entity: 'instagramSavedReel', id: shortcode }));
      const saved = write(context, check, () => {
        orm
          .update(instagramSavedReels)
          .set({ templateId })
          .where(eq(instagramSavedReels.shortcode, shortcode))
          .run();
      });
      return saved.ok ? ok({ previousTemplateId: before.templateId }) : saved;
    },

    async clear(context) {
      return write(
        context,
        () => ok(undefined),
        () => {
          orm.delete(instagramSavedReels).run();
          orm.delete(instagramCollections).run();
        },
      );
    },
  };
}
