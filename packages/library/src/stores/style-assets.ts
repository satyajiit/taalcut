// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style assets (brand logos, P3-V10) as content-addressed files beside template assets, `<dir>/<2 hex>/<sha256>`
 * (content-assets.ts), with a `style_assets` row each. A Style names at most one (its logo). When the last Style
 * naming an asset lets go of it, `released_at` is stamped; an asset unreferenced for 7 days (since its release,
 * or since it was put if no Style ever named it) is pruned by `library.collect`, so an undo soon after a logo
 * change still finds the old file.
 */
import { LOGO_LIMITS, LOGO_MEDIA_TYPES, type LogoMediaType } from '@taalcut/core';
import { and, eq, notExists, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { styleAssets, styles } from '../schema/styles';
import { createContentAssets } from './content-assets';

export { contentAssetPath as styleAssetPath } from './content-assets';

/** An asset no Style names goes after this long. */
export const UNUSED_STYLE_ASSET_MS = 7 * 24 * 60 * 60 * 1000;

const notNamed = (db: LibraryDatabase) =>
  notExists(db.orm.select({ one: styles.id }).from(styles).where(eq(styles.logoAsset, styleAssets.sha256)));

export function createStyleAssets(db: LibraryDatabase, dir: string) {
  const { orm } = db;
  const assets = createContentAssets<LogoMediaType>(db, dir, {
    entity: 'style_asset',
    table: styleAssets,
    sha256: styleAssets.sha256,
    mediaTypes: LOGO_MEDIA_TYPES,
    maxBytes: LOGO_LIMITS.bytes,
    keepUnusedMs: UNUSED_STYLE_ASSET_MS,
    insert: (row) =>
      orm
        .insert(styleAssets)
        .values({ ...row, releasedAt: null })
        // Put again: the 7 days start over, as for a new file.
        .onConflictDoUpdate({ target: styleAssets.sha256, set: { createdAt: row.createdAt } })
        .run(),
    unused: (cutoff) =>
      and(notNamed(db), sql`coalesce(${styleAssets.releasedAt}, ${styleAssets.createdAt}) < ${cutoff}`),
  });
  return {
    ...assets,

    /**
     * After a Style write (inside its transaction): `named` is held again (released_at cleared) and `dropped`,
     * the logo the Style no longer names, is released when no other Style names it.
     */
    track(named: string | null, dropped: string | null): void {
      if (named) {
        orm.update(styleAssets).set({ releasedAt: null }).where(eq(styleAssets.sha256, named)).run();
      }
      if (dropped && dropped !== named) {
        orm
          .update(styleAssets)
          .set({ releasedAt: db.clock() })
          .where(and(eq(styleAssets.sha256, dropped), notNamed(db)))
          .run();
      }
    },
  };
}
