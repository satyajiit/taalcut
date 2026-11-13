// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's TemplateMediaStore over migration 37 (REF1): each template's kept reel, video and music, as one file in
 * `<templates root>/media/<template id>/` and one `template_media` row. The file lands first (a temp name beside it,
 * fsynced, renamed into place) and the row after, so a row always has its file. A download moves in from scratch
 * (a rename on the same volume); a person's file is copied and left as it was.
 *
 * The row goes with its template (ON DELETE CASCADE). The folder can't go inside the delete's transaction (a
 * rollback would keep the row and lose the file), so `prune` removes folders whose template is gone: the desktop
 * root runs it once a delete commits, and at start-up.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { copyFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import {
  err,
  NotFoundError,
  ok,
  toTaalcutError,
  ULID_PATTERN,
  ValidationError,
  type KeepTemplateMediaInput,
  type Result,
  type TemplateId,
  type TemplateMedia,
  type TemplateMediaStore,
} from '@taalcut/core';
import { eq, inArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { fsyncPath, moveFile } from '../files/durable-files';
import { attemptWrite } from '../repositories/shared';
import { templateMedia, templates } from '../schema/templates';

/** `<templates root>/media/<template id>/`: a template's media folder. */
export function templateMediaFolder(templatesRoot: string, templateId: string): string {
  return join(templatesRoot, 'media', templateId);
}

/** The kept file's absolute path. */
export function templateMediaPath(templatesRoot: string, templateId: string, media: TemplateMedia): string {
  return join(templateMediaFolder(templatesRoot, templateId), media.file);
}

export type TemplateMediaRow = typeof templateMedia.$inferSelect;

export function mediaOfRow(row: TemplateMediaRow): TemplateMedia {
  return {
    file: row.file,
    bytes: row.bytes,
    durationMs: row.durationMs,
    sha256: row.sha256,
    hasAudio: row.hasAudio,
    source: row.source,
    keptAt: row.keptAt,
  };
}

/** The kept file's name: `reference.<ext>`, the extension of what came (lower case), mp4 when it has none. */
export function keptFileName(path: string): string {
  const ext = extname(path).slice(1).toLowerCase();
  return `reference.${/^[a-z0-9]{1,8}$/.test(ext) ? ext : 'mp4'}`;
}

/** A temp file younger than this may belong to a keep still in progress. */
const STRAY_GRACE_MS = 60_000;

export interface LibraryTemplateMediaStore extends TemplateMediaStore {
  /** The kept media of these templates, for summaries (one query). */
  mediaOf(templateIds: readonly TemplateId[]): Map<TemplateId, TemplateMedia>;
  /**
   * Folders whose template is gone, stray files beside a kept one, and rows whose file is gone. Run at start-up
   * and after a delete commits. Returns how many folders and rows went.
   */
  prune(): Result<{ readonly folders: number; readonly rows: number }>;
}

async function sha256Of(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

export function createTemplateMediaStore(
  db: LibraryDatabase,
  options: { readonly templatesRoot: string },
): LibraryTemplateMediaStore {
  const { orm } = db;
  const mediaRoot = join(options.templatesRoot, 'media');
  const templateExists = (id: TemplateId) =>
    orm.select({ id: templates.id }).from(templates).where(eq(templates.id, id)).get() !== undefined;
  const row = (id: TemplateId) =>
    orm.select().from(templateMedia).where(eq(templateMedia.templateId, id)).get();

  /** The file into the folder under a temp name, fsynced: a move for a download, a copy for a person's file. */
  async function bring(input: KeepTemplateMediaInput, temp: string): Promise<void> {
    if (input.mode === 'move') await moveFile(input.path, temp);
    else await copyFile(input.path, temp);
    await fsyncPath(temp);
  }

  return {
    async keep(templateId, input) {
      if (!ULID_PATTERN.test(templateId)) return err(ValidationError({ field: 'templateId' }));
      if (!Number.isInteger(input.durationMs) || input.durationMs <= 0)
        return err(ValidationError({ field: 'durationMs' }));
      if (!templateExists(templateId)) return err(NotFoundError({ entity: 'template', id: templateId }));
      const found = await stat(input.path).catch(() => null);
      if (!found?.isFile())
        return err(NotFoundError({ entity: 'template_media_file' }, { detail: input.path }));
      const folder = templateMediaFolder(options.templatesRoot, templateId);
      const file = keptFileName(input.path);
      const target = join(folder, file);
      const temp = join(folder, `.${file}.${randomBytes(6).toString('hex')}.tmp`);
      let media: TemplateMedia;
      try {
        await mkdir(folder, { recursive: true });
        await bring(input, temp);
        const [bytes, sha256] = [(await stat(temp)).size, await sha256Of(temp)];
        if (bytes === 0) throw new Error('the file is empty');
        await rename(temp, target);
        await fsyncPath(folder);
        media = {
          file,
          bytes,
          durationMs: input.durationMs,
          sha256,
          hasAudio: input.hasAudio,
          source: input.source,
          keptAt: db.clock(),
        };
      } catch (cause) {
        await rm(temp, { force: true }).catch(() => undefined);
        return err(toTaalcutError(cause));
      }
      const saved = attemptWrite(db, 'template_media', () =>
        orm
          .insert(templateMedia)
          .values({ templateId, ...media })
          .onConflictDoUpdate({ target: templateMedia.templateId, set: media })
          .run(),
      );
      if (!saved.ok) {
        // The template went while the file came: nothing of it stays.
        if (!templateExists(templateId)) await rm(folder, { recursive: true, force: true });
        return saved;
      }
      // An earlier reel of another kind (reference.webm before a reference.mp4) goes.
      for (const name of readdirSync(folder))
        if (name !== file && !name.startsWith('.')) rmSync(join(folder, name), { force: true });
      return ok(media);
    },

    async get(templateId) {
      const found = row(templateId);
      if (!found) return ok(null);
      const media = mediaOfRow(found);
      const path = templateMediaPath(options.templatesRoot, templateId, media);
      return existsSync(path) ? ok({ media, path }) : ok(null);
    },

    async remove(templateId) {
      const removed = attemptWrite(db, 'template_media', () =>
        orm.delete(templateMedia).where(eq(templateMedia.templateId, templateId)).run(),
      );
      if (!removed.ok) return removed;
      if (ULID_PATTERN.test(templateId))
        await rm(templateMediaFolder(options.templatesRoot, templateId), { recursive: true, force: true });
      return ok(undefined);
    },

    mediaOf(templateIds) {
      const ids = [...new Set(templateIds)];
      if (ids.length === 0) return new Map();
      const rows = orm.select().from(templateMedia).where(inArray(templateMedia.templateId, ids)).all();
      return new Map(rows.map((found) => [found.templateId, mediaOfRow(found)]));
    },

    prune() {
      let folders = 0;
      const now = Date.now();
      const names = existsSync(mediaRoot) ? readdirSync(mediaRoot) : [];
      for (const name of names) {
        if (!ULID_PATTERN.test(name)) continue;
        const folder = join(mediaRoot, name);
        if (!statSync(folder, { throwIfNoEntry: false })?.isDirectory()) continue;
        if (!templateExists(name as TemplateId)) {
          rmSync(folder, { recursive: true, force: true });
          folders += 1;
          continue;
        }
        // No row yet: a keep may be between its file and its row. Leave the folder to it.
        const kept = row(name as TemplateId)?.file;
        if (!kept) continue;
        for (const file of readdirSync(folder)) {
          if (file === kept) continue;
          const modified = statSync(join(folder, file), { throwIfNoEntry: false })?.mtimeMs ?? 0;
          if (now - modified > STRAY_GRACE_MS) rmSync(join(folder, file), { recursive: true, force: true });
        }
      }
      // A row whose file is gone says nothing true: the template then has no media, and can fetch it again.
      const missing = orm
        .select()
        .from(templateMedia)
        .all()
        .filter(
          (found) =>
            !existsSync(templateMediaPath(options.templatesRoot, found.templateId, mediaOfRow(found))),
        )
        .map((found) => found.templateId);
      const rows = attemptWrite(db, 'template_media', () =>
        missing.length === 0
          ? 0
          : orm.delete(templateMedia).where(inArray(templateMedia.templateId, missing)).run().changes,
      );
      return rows.ok ? ok({ folders, rows: rows.value }) : rows;
    },
  };
}
