// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Pruning the workspace folders (HFW1-WS). A blob stays while anything can still need its bytes:
 *
 * - any revision of its project's workspace (revisions are kept as long as the project: an undo, a redo or a
 *   restore can make any of them the head again);
 * - a composition copy on one of its project's timelines (`graphicCompositions`), or on a saved version of one,
 *   which "Restore version" brings back;
 * - a composition of any template (`graphics.compositions`, every version), in whichever project's folder it is,
 *   and in the templates' pool (HFW1-TPL, `workspaces/templates/`), where only that keeps a blob.
 *
 * Anything else goes, but only once it is older than `keepUnnamedMs`: a tool puts a file's bytes before it
 * dispatches the write that names them, and a put of bytes already there refreshes their time. The folder of a
 * project that is gone goes whole. Nothing here follows a link: a link in the folder is removed, never its target.
 */
import { type Dirent } from 'node:fs';
import { lstat, readdir, rm, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { err, ok, TEMPLATE_BLOBS_SCOPE, toTaalcutError, ULID_PATTERN, type AsyncResult } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { BLOBS_FOLDER, workspacesRoot } from './workspace-blobs';

/** How long a blob nothing names is kept by default: long enough for any tool's put-then-write. */
export const UNNAMED_WORKSPACE_BLOB_MS = 60 * 60_000;

export interface WorkspacePruneOptions {
  readonly keepUnnamedMs?: number;
  /** Wall-clock milliseconds, to compare with the files' times (default Date.now). */
  readonly now?: () => number;
}

export interface WorkspacePruneReport {
  /** Blobs (and stray files) deleted. */
  readonly blobs: number;
  /** Folders of projects no longer in the library, deleted whole. */
  readonly folders: number;
  /** Links found in the folders and removed. */
  readonly links: number;
}

const HEX2 = /^[0-9a-f]{2}$/;

/** The `sha256` column of every row `sql` selects. */
function namedIn(db: LibraryDatabase, sql: string, ...params: string[]): string[] {
  return db.driver
    .prepare(sql)
    .all(...params)
    .map((row) => row.sha256)
    .filter((sha256): sha256 is string => typeof sha256 === 'string');
}

/** The blobs templates name: every version's compositions. */
const templateBlobs = (db: LibraryDatabase) =>
  namedIn(
    db,
    `SELECT DISTINCT json_extract(f.value, '$.sha256') AS sha256
       FROM template_versions v,
            json_each(v.document, '$.graphics.compositions') c,
            json_each(c.value, '$.files') f
      WHERE json_valid(v.document)`,
  );

/** The blobs one project names: its revisions, its timelines' copies and their saved versions' copies. */
function projectBlobs(db: LibraryDatabase, projectId: string): string[] {
  const revisions = namedIn(
    db,
    `SELECT DISTINCT json_extract(f.value, '$.sha256') AS sha256
       FROM workspace_revisions r, json_each(r.files) f
      WHERE r.project_id = ?`,
    projectId,
  );
  const timelines = namedIn(
    db,
    `SELECT DISTINCT json_extract(f.value, '$.sha256') AS sha256
       FROM timelines t,
            json_each(t.document, '$.graphicCompositions') c,
            json_each(c.value, '$.files') f
      WHERE t.project_id = ? AND json_valid(t.document)`,
    projectId,
  );
  const versions = namedIn(
    db,
    `SELECT DISTINCT json_extract(f.value, '$.sha256') AS sha256
       FROM timeline_versions v
       JOIN timelines t ON t.id = v.timeline_id,
            json_each(v.document, '$.graphicCompositions') c,
            json_each(c.value, '$.files') f
      WHERE t.project_id = ? AND json_valid(v.document)`,
    projectId,
  );
  return [...revisions, ...timelines, ...versions];
}

async function entries(path: string): Promise<Dirent[]> {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw cause;
  }
}

export async function pruneWorkspaces(
  db: LibraryDatabase,
  dataRoot: string,
  options: WorkspacePruneOptions = {},
): AsyncResult<WorkspacePruneReport> {
  const keepMs = options.keepUnnamedMs ?? UNNAMED_WORKSPACE_BLOB_MS;
  const now = options.now ?? Date.now;
  const report = { blobs: 0, folders: 0, links: 0 };
  try {
    const root = workspacesRoot(dataRoot);
    const rootStats = await lstat(root).catch(() => null);
    // Not a real folder of ours (missing, or a link to somewhere else): nothing in it is Taalcut's to delete.
    if (!rootStats?.isDirectory()) return ok(report);
    const known = new Set(
      db.driver
        .prepare('SELECT id FROM projects')
        .all()
        .map((row) => String(row.id)),
    );
    const forTemplates = new Set(templateBlobs(db));

    /** Removes a file nothing names once it is old enough; a link at once. */
    const sweepFile = async (path: string, entry: Dirent, named: ReadonlySet<string>) => {
      if (entry.isSymbolicLink()) {
        await unlink(path);
        report.links += 1;
        return;
      }
      if (!entry.isFile() || named.has(entry.name)) return;
      const stats = await lstat(path);
      if (now() - stats.mtimeMs <= keepMs) return;
      await unlink(path);
      report.blobs += 1;
    };

    /** Sweeps one folder's `blobs/<2hex>/` buckets, keeping what `named` names. */
    const sweepBlobs = async (folder: string, named: ReadonlySet<string>) => {
      const blobs = join(folder, BLOBS_FOLDER);
      const blobsStats = await lstat(blobs).catch(() => null);
      if (blobsStats?.isSymbolicLink()) {
        await unlink(blobs);
        report.links += 1;
        return;
      }
      if (!blobsStats?.isDirectory()) return;
      for (const bucket of await entries(blobs)) {
        const bucketPath = join(blobs, bucket.name);
        if (bucket.isSymbolicLink()) {
          await unlink(bucketPath);
          report.links += 1;
          continue;
        }
        if (!bucket.isDirectory() || !HEX2.test(bucket.name)) continue;
        for (const entry of await entries(bucketPath))
          await sweepFile(join(bucketPath, entry.name), entry, named);
      }
    };

    for (const project of await entries(root)) {
      const folder = join(root, project.name);
      if (project.name === TEMPLATE_BLOBS_SCOPE) {
        if (project.isSymbolicLink()) {
          await unlink(folder);
          report.links += 1;
        } else if (project.isDirectory()) await sweepBlobs(folder, forTemplates);
        continue;
      }
      if (!ULID_PATTERN.test(project.name)) continue;
      if (project.isSymbolicLink()) {
        await unlink(folder);
        report.links += 1;
        continue;
      }
      if (!project.isDirectory()) continue;
      if (!known.has(project.name)) {
        // rm doesn't follow the links inside: they go as links.
        await rm(folder, { recursive: true, force: true });
        report.folders += 1;
        continue;
      }
      await sweepBlobs(folder, new Set([...projectBlobs(db, project.name), ...forTemplates]));
    }
    return ok(report);
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}
