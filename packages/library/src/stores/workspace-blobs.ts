// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A project's workspace blobs on disk, `<dataRoot>/workspaces/<projectId>/blobs/<2hex>/<sha256>` (core's
 * workspaceBlobPath; the content-assets layout without a row per blob: the revisions, timelines and templates
 * that name a blob are what keep it). A blob is written durably once per sha256 and checked against its name on
 * every read, so a changed or truncated file reads as missing, never as someone's bytes.
 *
 * Nothing here follows a symbolic link: every folder below the data root is checked with lstat (and made one by
 * one), and a blob is opened with O_NOFOLLOW, so a link planted in the folder can't send a write or a read
 * outside it. Project ids are ULIDs in upper case only: on a case-insensitive disk `01abc…` would name the same
 * folder as `01ABC…`. HFW1-TPL: the templates' pool is the same layout under `workspaces/templates/` (core's
 * templateBlobPath), a name no ULID can be.
 */
import { constants, type Stats } from 'node:fs';
import { lstat, mkdir, open, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  NotFoundError,
  ok,
  toTaalcutError,
  TEMPLATE_BLOBS_SCOPE,
  ULID_PATTERN,
  ValidationError,
  WORKSPACE_LIMITS,
  type AsyncResult,
  type Result,
} from '@taalcut/core';
import { writeDurably } from '../files/durable-files';
import { sha256Hex } from './canonical';

const SHA256 = /^[0-9a-f]{64}$/;
export const WORKSPACES_FOLDER = 'workspaces';
export const BLOBS_FOLDER = 'blobs';

/** `<dataRoot>/workspaces`: every project's workspace folder is in it. */
export const workspacesRoot = (dataRoot: string) => join(dataRoot, WORKSPACES_FOLDER);

const blobMissing = (sha256: string, detail?: string) =>
  err(NotFoundError({ entity: 'workspaceBlob', id: sha256 }, detail ? { detail } : {}));

const linked = (at: string) =>
  err(ValidationError({ field: 'path' }, { detail: `${at} is a symbolic link, not a folder of Taalcut's` }));

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw cause;
  }
}

/**
 * `<dataRoot>/<segments…>` as real folders: each one is a folder and none is a link. With `create`, missing ones
 * are made one at a time (never `recursive`, which would follow a link on the way); without it, a missing one is
 * `null`. The data root itself is the app's, and may be reached through a link (`/var` on a Mac).
 */
async function realFolder(
  dataRoot: string,
  segments: readonly string[],
  create: boolean,
): Promise<Result<string | null>> {
  let path = dataRoot;
  for (const segment of segments) {
    path = join(path, segment);
    const stats = await lstatOrNull(path);
    if (stats?.isSymbolicLink()) return linked(segment);
    if (stats && !stats.isDirectory())
      return err(ValidationError({ field: 'path' }, { detail: `${segment}` }));
    if (stats) continue;
    if (!create) return ok(null);
    try {
      await mkdir(path);
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause;
      const again = await lstat(path);
      if (again.isSymbolicLink() || !again.isDirectory()) return linked(segment);
    }
  }
  return ok(path);
}

/** The folders a blob sits in, from the data root. */
const blobFolders = (projectId: string, sha256: string) => [
  WORKSPACES_FOLDER,
  projectId,
  BLOBS_FOLDER,
  sha256.slice(0, 2),
];

/** Reads a regular file without following a link; null when there is none (or a link stands there). */
async function readNoFollow(path: string, limit: number): Promise<Uint8Array | null | 'large'> {
  let handle;
  try {
    handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  } catch (cause) {
    const code = (cause as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ELOOP' || code === 'EMLINK') return null;
    throw cause;
  }
  try {
    const stats = await handle.stat();
    if (!stats.isFile()) return null;
    if (stats.size > limit) return 'large';
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

export interface WorkspaceBlobs {
  /** `<dataRoot>/workspaces/<projectId>`. */
  folder(projectId: string): string;
  /** Keeps `data` as a blob (once per sha256); a blob already there gets a fresh time, so a prune spares it. */
  put(projectId: string, data: Uint8Array): AsyncResult<{ sha256: string; bytes: number }>;
  /** The blob's bytes, checked against its sha256; core.not_found for a missing, changed or linked one. */
  read(projectId: string, sha256: string): AsyncResult<Uint8Array>;
}

/** Checks a project id (or HFW1-TPL's templates' pool) and sha256 before either names a folder. */
function names(projectId: string, sha256?: string): Result<void> {
  if (!ULID_PATTERN.test(projectId) && projectId !== TEMPLATE_BLOBS_SCOPE)
    return err(ValidationError({ field: 'projectId' }));
  if (sha256 !== undefined && !SHA256.test(sha256)) return err(ValidationError({ field: 'sha256' }));
  return ok(undefined);
}

export function createWorkspaceBlobs(
  dataRoot: string,
  fileBytes: number = WORKSPACE_LIMITS.fileBytes,
): WorkspaceBlobs {
  const pathOf = (projectId: string, sha256: string) =>
    join(dataRoot, ...blobFolders(projectId, sha256), sha256);

  async function read(projectId: string, sha256: string): AsyncResult<Uint8Array> {
    const named = names(projectId, sha256);
    if (!named.ok) return named;
    try {
      const folder = await realFolder(dataRoot, blobFolders(projectId, sha256), false);
      if (!folder.ok) return blobMissing(sha256, folder.error.detail);
      if (folder.value === null) return blobMissing(sha256);
      const data = await readNoFollow(pathOf(projectId, sha256), fileBytes);
      if (data === null) return blobMissing(sha256);
      if (data === 'large') return blobMissing(sha256, 'larger than a workspace file');
      // A blob is its bytes' sha256: anything else was changed on disk and is no one's file.
      if (sha256Hex(data) !== sha256) return blobMissing(sha256, 'its bytes no longer match its name');
      return ok(data);
    } catch (cause) {
      return err(toTaalcutError(cause));
    }
  }

  return {
    folder: (projectId) => join(dataRoot, WORKSPACES_FOLDER, projectId),
    read,

    async put(projectId, data) {
      const named = names(projectId);
      if (!named.ok) return named;
      if (data.length > fileBytes)
        return err(
          ValidationError(
            { field: 'bytes' },
            { detail: `${data.length} bytes; a workspace file holds at most ${fileBytes}` },
          ),
        );
      const sha256 = sha256Hex(data);
      try {
        const folder = await realFolder(dataRoot, blobFolders(projectId, sha256), true);
        if (!folder.ok) return folder;
        const path = pathOf(projectId, sha256);
        const there = await lstatOrNull(path);
        if (there?.isSymbolicLink()) return linked(sha256);
        if (there?.isFile() && (await read(projectId, sha256)).ok) {
          const now = new Date();
          await utimes(path, now, now);
        } else {
          // Missing, or changed on disk: the rename replaces it whole.
          await writeDurably(path, data);
        }
        return ok({ sha256, bytes: data.length });
      } catch (cause) {
        return err(toTaalcutError(cause));
      }
    },
  };
}
