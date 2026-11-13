// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's TemplateStore (P2-T8) over migrations 14 and 20: lineages with a head,
 * immutable numbered versions, content-addressed assets, full-text search, and
 * each lineage's library metadata (P3-V14: tags, folder, favourite, trend date,
 * provenance), which changes no version.
 *
 * Writes given a CommandContext are checked now and staged on the command's
 * unit of work, so they commit with its audit row (the staged write checks
 * again, inside the commit). Without a context they commit at once.
 */
import {
  ConflictError,
  err,
  extractInstagramShortcode,
  NotFoundError,
  ok,
  templateSchema,
  ValidationError,
  type Result,
  type Template,
  type TemplateId,
  type TemplateStore,
} from '@taalcut/core';
import { and, desc, eq, isNull, max } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { instagramSavedReels } from '../schema/instagram';
import { templateFolders, templateMedia, templates, templateVersions } from '../schema/templates';
import { createTemplateAssets } from './template-assets';
import { folderNotFound } from './template-folder-errors';
import { mediaOfRow } from './template-media-store';
import { stagedWriter } from './staged-write';
import { listTemplates } from './template-list';
import { checkedProvenance, checkedTrend, cleanName, lineageChanges } from './template-meta';
import {
  ftsColumns,
  newLineageRow,
  toSummary,
  toVersionSummary,
  versionColumns,
  type TemplateRow,
} from './template-rows';

export interface TemplateStoreOptions {
  /** Where asset files live: `<app data>/templates/assets`. */
  readonly assetsDir: string;
  /** createLibraryPorts(db).commands: writes with a context commit with the command's audit row. */
  readonly commands?: CommandStager;
}

export interface LibraryTemplateStore extends TemplateStore {
  /** Assets no version uses, older than 7 days by default, and stray files. Run at start-up and daily. */
  pruneAssets(options?: { readonly olderThanMs?: number }): Result<number>;
}

const MISSING = (id: string) => err(NotFoundError({ entity: 'template', id }));
const NO_VERSION = (id: string) => err(NotFoundError({ entity: 'template_version', id }));

export function createTemplateStore(
  db: LibraryDatabase,
  options: TemplateStoreOptions,
): LibraryTemplateStore {
  const { orm } = db;
  const assets = createTemplateAssets(db, options.assetsDir);
  const write = stagedWriter(db, options.commands, 'template');
  const row = (id: TemplateId) => orm.select().from(templates).where(eq(templates.id, id)).get();
  const versionRow = (id: TemplateId, version: number) =>
    orm
      .select()
      .from(templateVersions)
      .where(and(eq(templateVersions.templateId, id), eq(templateVersions.version, version)))
      .get();

  /** REF1: the template's kept reel, for its summary; null without one. */
  const mediaOf = (id: TemplateId) => {
    const found = orm.select().from(templateMedia).where(eq(templateMedia.templateId, id)).get();
    return found ? mediaOfRow(found) : null;
  };

  /** Rewrites the lineage's search row from its head (inside the caller's transaction). */
  function indexHead(id: TemplateId): void {
    db.driver.prepare('DELETE FROM template_fts WHERE template_id = ?').run(id);
    const lineage = row(id);
    const head = lineage && versionRow(id, lineage.headVersion);
    if (!lineage || !head) return;
    const { intents, overlays, tags } = ftsColumns(lineage.name, head.document, lineage.tags);
    db.driver
      .prepare('INSERT INTO template_fts (template_id, name, intents, overlays, tags) VALUES (?, ?, ?, ?, ?)')
      .run(id, lineage.name, intents, overlays, tags);
  }

  function valid(template: Template): Result<Template> {
    const parsed = templateSchema.safeParse(template);
    return parsed.success
      ? ok(template)
      : err(ValidationError({ field: 'template' }, { detail: parsed.error.message.slice(0, 2000) }));
  }

  /** The lineage exists, and so does the folder a patch moves it into. */
  function lineageAndFolder(id: TemplateId, folderId: TemplateRow['folderId'] | undefined): Result<void> {
    if (!row(id)) return MISSING(id);
    if (folderId) {
      const folder = orm.select().from(templateFolders).where(eq(templateFolders.id, folderId)).get();
      if (!folder) return err(folderNotFound());
    }
    return ok(undefined);
  }

  /** Moves the head (a new version or an undo/redo) and stamps the lineage changed. */
  function moveHead(lineage: TemplateRow, version: number, now: number): TemplateRow {
    orm
      .update(templates)
      .set({ headVersion: version, updatedAt: now })
      .where(eq(templates.id, lineage.id))
      .run();
    indexHead(lineage.id);
    return { ...lineage, headVersion: version, updatedAt: now };
  }

  return {
    async create(template, meta, context) {
      const checked = valid(template);
      if (!checked.ok) return checked;
      const name = cleanName(meta.name);
      if (!name.ok) return name;
      if (template.version !== 1 || template.parentVersion !== null)
        return err(ValidationError({ field: 'version' }, { detail: 'a lineage starts at version 1' }));
      const provenance = checkedProvenance(meta.provenance ?? null);
      if (!provenance.ok) return provenance;
      const trend = checkedTrend(meta.trendFreshness ?? null);
      if (!trend.ok) return trend;
      const now = db.clock();
      const lineage = newLineageRow({
        id: template.id,
        name: name.value,
        projectId: meta.projectId,
        listed: meta.listed,
        provenance: provenance.value,
        ...trend.value,
        createdAt: now,
      });
      const columns = versionColumns(template);
      const check = () =>
        row(template.id) ? err(ConflictError({ entity: 'template', id: template.id })) : ok(undefined);
      const shortcode =
        template.origin.kind === 'reference' && template.origin.url
          ? extractInstagramShortcode(template.origin.url)
          : null;
      const saved = write(context, check, () => {
        orm.insert(templates).values(lineage).run();
        orm
          .insert(templateVersions)
          .values({ ...columns, templateId: template.id, version: 1, parentVersion: null, createdAt: now })
          .run();
        if (shortcode) {
          orm
            .update(instagramSavedReels)
            .set({ templateId: template.id })
            .where(and(eq(instagramSavedReels.shortcode, shortcode), isNull(instagramSavedReels.templateId)))
            .run();
        }
        indexHead(template.id);
        return ok(undefined);
      });
      return saved.ok ? ok(toSummary(lineage, columns, undefined, mediaOf(template.id))) : saved;
    },

    async addVersion(template, change, context) {
      const checked = valid(template);
      if (!checked.ok) return checked;
      const id = template.id;
      const parent = template.parentVersion;
      if (parent === null || parent >= template.version)
        return err(
          ValidationError({ field: 'parentVersion' }, { detail: 'a later version names an earlier parent' }),
        );
      const columns = versionColumns(template);
      const check = (): Result<void> => {
        if (!row(id)) return MISSING(id);
        if (!versionRow(id, parent)) return err(ValidationError({ field: 'parentVersion' }));
        if (versionRow(id, template.version)) return err(ConflictError({ entity: 'template_version', id }));
        return ok(undefined);
      };
      const before = row(id);
      if (!before) return MISSING(id);
      const now = db.clock();
      const saved = write(context, check, () => {
        orm
          .insert(templateVersions)
          .values({
            ...columns,
            templateId: id,
            version: template.version,
            parentVersion: parent,
            changeKey: change.changeKey,
            command: change.command,
            source: change.source,
            createdAt: now,
          })
          .run();
        moveHead(before, template.version, now);
        return ok(undefined);
      });
      if (!saved.ok) return saved;
      return ok(
        toSummary(
          { ...before, headVersion: template.version, updatedAt: now },
          columns,
          undefined,
          mediaOf(id),
        ),
      );
    },

    async setHead(input, context) {
      const { templateId: id, version, expectedHead } = input;
      const check = (): Result<void> => {
        const lineage = row(id);
        if (!lineage) return MISSING(id);
        if (lineage.headVersion !== expectedHead)
          return err(ConflictError({ entity: 'template', id }, { detail: `head is ${lineage.headVersion}` }));
        return versionRow(id, version) ? ok(undefined) : NO_VERSION(id);
      };
      const before = row(id);
      const target = versionRow(id, version);
      if (!before) return MISSING(id);
      if (!target) return NO_VERSION(id);
      const now = db.clock();
      const saved = write(context, check, () => ok(moveHead(before, version, now)));
      if (!saved.ok) return saved;
      return ok(
        toSummary({ ...before, headVersion: version, updatedAt: now }, target, undefined, mediaOf(id)),
      );
    },

    async setMeta(id, patch, context) {
      const before = row(id);
      if (!before) return MISSING(id);
      const head = versionRow(id, before.headVersion);
      if (!head) return NO_VERSION(id);
      const now = db.clock();
      const changed = lineageChanges(patch, before, now);
      if (!changed.ok) return changed;
      const update = { ...changed.value, updatedAt: now };
      const check = () => lineageAndFolder(id, update.folderId);
      const saved = write(context, check, () => {
        orm.update(templates).set(update).where(eq(templates.id, id)).run();
        if (update.name !== undefined || update.tags !== undefined) indexHead(id);
        return ok(undefined);
      });
      if (!saved.ok) return saved;
      return ok(toSummary({ ...before, ...update }, head, undefined, mediaOf(id)));
    },

    async remove(id, context) {
      const check = () => (row(id) ? ok(undefined) : MISSING(id));
      return write(context, check, () => {
        const sheets = orm
          .select({ sha256: templateVersions.contactSheet })
          .from(templateVersions)
          .where(eq(templateVersions.templateId, id))
          .all()
          .flatMap((v) => (v.sha256 ? [v.sha256] : []));
        orm.delete(templates).where(eq(templates.id, id)).run();
        db.driver.prepare('DELETE FROM template_fts WHERE template_id = ?').run(id);
        // Rows only: the files go with the next prune, after this commit (a rollback keeps them). The kept reel's
        // row goes with the lineage (ON DELETE CASCADE); its folder with the media store's prune.
        assets.dropUnused(sheets);
        return ok(undefined);
      });
    },

    async get(id, version) {
      const lineage = row(id);
      if (!lineage) return MISSING(id);
      const stored = versionRow(id, version ?? lineage.headVersion);
      const head = versionRow(id, lineage.headVersion);
      if (!stored || !head) return NO_VERSION(id);
      return ok({
        summary: toSummary(lineage, head, undefined, mediaOf(id)),
        version: stored.version,
        schemaVersion: stored.schemaVersion,
        json: stored.document,
      });
    },

    async findChild(id, parentVersion, changeKey) {
      const child = orm
        .select({ version: templateVersions.version })
        .from(templateVersions)
        .where(
          and(
            eq(templateVersions.templateId, id),
            eq(templateVersions.parentVersion, parentVersion),
            eq(templateVersions.changeKey, changeKey),
          ),
        )
        .orderBy(desc(templateVersions.version))
        .get();
      return ok(child?.version ?? null);
    },

    async latestVersion(id) {
      const latest = orm
        .select({ version: max(templateVersions.version) })
        .from(templateVersions)
        .where(eq(templateVersions.templateId, id))
        .get();
      return latest?.version ? ok(latest.version) : MISSING(id);
    },

    async versions(id) {
      const lineage = row(id);
      if (!lineage) return MISSING(id);
      return ok(
        orm
          .select()
          .from(templateVersions)
          .where(eq(templateVersions.templateId, id))
          .orderBy(templateVersions.version)
          .all()
          .map((v) => toVersionSummary(v, lineage.headVersion)),
      );
    },

    list: async (query) => listTemplates(db, query),

    async usedBy(id) {
      const used = db.driver.prepare('SELECT count(*) AS n FROM timelines WHERE template_id = ?').get(id);
      return ok(Number(used?.n ?? 0));
    },

    putAsset: async (bytes, mediaType) => assets.put(bytes, mediaType),
    assetPath: async (sha256) => assets.path(sha256),
    pruneAssets: (pruneOptions = {}) => assets.prune(pruneOptions.olderThanMs),
  };
}
