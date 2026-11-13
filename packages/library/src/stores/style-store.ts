// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's StyleStore (P3-V10) over migration 20's `styles` and `style_assets`. A Style is one row (no versions:
 * `put` names the revision it replaces, core.conflict otherwise); its logo is a content-addressed style asset.
 * `usedBy` counts timelines (by `timelines.style_id`) and template versions (by `template_versions.style_id`)
 * that name it. The default Style is the `styles.default` setting. Writes given a CommandContext are staged on
 * the command's unit of work, so they commit with its audit row.
 */
import {
  ConflictError,
  DEFAULT_STYLE_SETTING,
  err,
  NotFoundError,
  ok,
  type Result,
  type StyleId,
  type StyleStore,
} from '@taalcut/core';
import { and, count, desc, eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { timelines } from '../schema/projects';
import { styles } from '../schema/styles';
import { templateVersions } from '../schema/templates';
import { stagedWriter } from './staged-write';
import { createStyleAssets } from './style-assets';
import { parsedStyle, styleColumns, styleSummary, type StyleRow } from './style-rows';
import { storedSetting } from './stored-setting';

export interface StyleStoreOptions {
  /** Where logo files live: `<app data>/styles/assets`. */
  readonly assetsDir: string;
  /** createLibraryPorts(db).commands: writes with a context commit with the command's audit row. */
  readonly commands?: CommandStager;
}

export interface LibraryStyleStore extends StyleStore {
  /** Logos no Style has named for 7 days (by default), and stray files. `library.collect` runs it. */
  pruneAssets(options?: { readonly olderThanMs?: number }): Result<number>;
}

const MISSING = (id: string) => err(NotFoundError({ entity: 'style', id }));

export function createStyleStore(db: LibraryDatabase, options: StyleStoreOptions): LibraryStyleStore {
  const { orm } = db;
  const assets = createStyleAssets(db, options.assetsDir);
  const write = stagedWriter(db, options.commands, 'style');
  const row = (id: StyleId) => orm.select().from(styles).where(eq(styles.id, id)).get();

  const stored = (found: StyleRow) => parsedStyle(found.document);

  return {
    async create(style, context) {
      const parsed = parsedStyle(style);
      if (!parsed.ok) return parsed;
      const columns = styleColumns(parsed.value);
      const check = () =>
        row(style.id) ? err(ConflictError({ entity: 'style', id: style.id })) : ok(undefined);
      const saved = write(context, check, () => {
        orm.insert(styles).values(columns).run();
        assets.track(columns.logoAsset, null);
      });
      return saved.ok ? parsed : saved;
    },

    async put(style, expectedRevision, context) {
      const parsed = parsedStyle(style);
      if (!parsed.ok) return parsed;
      const columns = styleColumns(parsed.value);
      const check = (): Result<void> => {
        const current = row(style.id);
        if (!current) return MISSING(style.id);
        return current.revision === expectedRevision
          ? ok(undefined)
          : err(
              ConflictError({ entity: 'style', id: style.id }, { detail: `revision is ${current.revision}` }),
            );
      };
      const saved = write(context, check, () => {
        const dropped = row(style.id)?.logoAsset ?? null;
        orm.update(styles).set(columns).where(eq(styles.id, style.id)).run();
        assets.track(columns.logoAsset, dropped);
      });
      return saved.ok ? parsed : saved;
    },

    async get(styleId) {
      const found = row(styleId);
      return found ? stored(found) : MISSING(styleId);
    },

    async list(filter = {}) {
      const { madeFrom } = filter;
      const rows = orm
        .select()
        .from(styles)
        .where(
          madeFrom
            ? and(
                eq(styles.madeFromTemplateId, madeFrom.templateId),
                madeFrom.version === undefined ? undefined : eq(styles.madeFromVersion, madeFrom.version),
              )
            : undefined,
        )
        .orderBy(desc(styles.updatedAt), desc(styles.id))
        .all();
      const defaultStyle = storedSetting(db, DEFAULT_STYLE_SETTING);
      const summaries = [];
      for (const found of rows) {
        const style = stored(found);
        if (!style.ok) return style;
        summaries.push(styleSummary(style.value, defaultStyle));
      }
      return ok(summaries);
    },

    async remove(styleId, context) {
      const check = () => (row(styleId) ? ok(undefined) : MISSING(styleId));
      return write(context, check, () => {
        const dropped = row(styleId)?.logoAsset ?? null;
        orm.delete(styles).where(eq(styles.id, styleId)).run();
        assets.track(null, dropped);
      });
    },

    async usedBy(styleId) {
      if (!row(styleId)) return MISSING(styleId);
      const used = (n: { n: number } | undefined) => n?.n ?? 0;
      return ok({
        timelines: used(
          orm.select({ n: count() }).from(timelines).where(eq(timelines.styleId, styleId)).get(),
        ),
        templates: used(
          orm
            .select({ n: count() })
            .from(templateVersions)
            .where(eq(templateVersions.styleId, styleId))
            .get(),
        ),
      });
    },

    putAsset: async (bytes, mediaType) => assets.put(bytes, mediaType),
    assetPath: async (sha256) => assets.path(sha256),
    pruneAssets: (pruneOptions = {}) => assets.prune(pruneOptions.olderThanMs),
  };
}
