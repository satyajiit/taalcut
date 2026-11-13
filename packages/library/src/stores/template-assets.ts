// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Template assets (contact sheets) as content-addressed files, `<assetsDir>/<2 hex>/<sha256>` (content-assets.ts),
 * with a `template_assets` row each. An asset no template version names is dropped with the version that let go
 * of it, or pruned after 7 days (an abandoned breakdown's sheet).
 */
import { and, eq, lt, notExists } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { TEMPLATE_ASSET_TYPES, templateAssets, templateVersions } from '../schema/templates';
import { createContentAssets } from './content-assets';

export { contentAssetPath as templateAssetPath } from './content-assets';

/** Contact sheets are a few hundred KB; anything near this is a bug upstream. */
export const MAX_TEMPLATE_ASSET_BYTES = 16 * 1024 * 1024;
/** An asset no version refers to goes after this long (an abandoned breakdown's sheet). */
export const UNUSED_TEMPLATE_ASSET_MS = 7 * 24 * 60 * 60 * 1000;

export type TemplateAssetType = (typeof TEMPLATE_ASSET_TYPES)[number];

const notInAnyVersion = (db: LibraryDatabase) =>
  notExists(
    db.orm
      .select({ one: templateVersions.version })
      .from(templateVersions)
      .where(eq(templateVersions.contactSheet, templateAssets.sha256)),
  );

export function createTemplateAssets(db: LibraryDatabase, dir: string) {
  const { orm } = db;
  const assets = createContentAssets<TemplateAssetType>(db, dir, {
    entity: 'template_asset',
    table: templateAssets,
    sha256: templateAssets.sha256,
    mediaTypes: TEMPLATE_ASSET_TYPES,
    maxBytes: MAX_TEMPLATE_ASSET_BYTES,
    keepUnusedMs: UNUSED_TEMPLATE_ASSET_MS,
    insert: (row) => orm.insert(templateAssets).values(row).onConflictDoNothing().run(),
    unused: (cutoff) => and(lt(templateAssets.createdAt, cutoff), notInAnyVersion(db)),
  });
  return {
    ...assets,

    /** Rows of these assets that no version refers to any more (inside the caller's transaction). */
    dropUnused(sha256s: readonly string[]): void {
      for (const sha256 of new Set(sha256s)) {
        orm
          .delete(templateAssets)
          .where(and(eq(templateAssets.sha256, sha256), notInAnyVersion(db)))
          .run();
      }
    },
  };
}
