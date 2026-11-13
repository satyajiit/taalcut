// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shell's `work/` is HFW1's workspace (AGT2 sbx): before a command the head revision is checked out there, and
 * after it what changed is read back as a new revision. Reading back is trusted code reading what a confined
 * process wrote, so it trusts nothing: it never follows a link, reads only regular files with one link (a hard link
 * could name a file the sandbox can't read), opens them without following and checks it opened the file it walked
 * to, and keeps only what a revision may hold (plain paths, 64 KB a file, the workspace's totals). `_taalcut/` is
 * Taalcut's: checked out to be read, never written back. What it doesn't keep it names, with why.
 */
import { constants as fsc } from 'node:fs';
import { lstat, mkdir, open, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import {
  ok,
  WORKSPACE_LIMITS,
  workspacePathSchema,
  type AsyncResult,
  type ProjectId,
  type WorkspaceStore,
} from '@taalcut/core';
import { createHash } from 'node:crypto';

/** Taalcut's folder in every workspace (render's RESERVED_FOLDER): read-only to the model. */
export const RESERVED_PREFIX = '_taalcut/';
/** Entries one read-back walks at most; a tree larger than this isn't a workspace. */
export const MAX_WALK = 5000;
/** Reasons it names at most; the rest are counted. */
export const MAX_NOT_KEPT = 20;

export interface BaseFile {
  readonly sha256: string;
  readonly bytes: number;
}

export interface CheckedOut {
  /** The head it was checked out at (0: nothing written yet). */
  readonly revision: number;
  readonly files: ReadonlyMap<string, BaseFile>;
}

interface CachedWorkFile {
  readonly sha256: string;
  readonly bytes: number;
  readonly mtimeMs: number;
}

const workDirCache = new Map<string, Map<string, CachedWorkFile>>();

/** Clears the incremental checkout cache for `workDir`. */
export function clearCheckoutCache(workDir: string): void {
  workDirCache.delete(resolve(workDir));
}

async function cleanExtraneous(
  workDir: string,
  rel: string,
  wantedFiles: ReadonlySet<string>,
  wantedDirs: ReadonlySet<string>,
  cache: Map<string, CachedWorkFile>,
): Promise<void> {
  const entries = await readdir(join(workDir, rel), { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const path = rel ? `${rel}/${entry.name}` : entry.name;
    const full = join(workDir, path);
    if (entry.isSymbolicLink()) {
      await rm(full, { recursive: true, force: true });
      cache.delete(path);
      continue;
    }
    if (entry.isDirectory()) {
      if (!wantedDirs.has(path)) {
        await rm(full, { recursive: true, force: true });
      } else {
        await cleanExtraneous(workDir, path, wantedFiles, wantedDirs, cache);
      }
      continue;
    }
    if (!entry.isFile() || !wantedFiles.has(path)) {
      await rm(full, { recursive: true, force: true });
      cache.delete(path);
    }
  }
}

/** Incrementally syncs `work/` to the head revision's files, skipping unchanged blobs already on disk. */
export async function checkoutHead(
  store: WorkspaceStore,
  projectId: ProjectId,
  workDir: string,
): AsyncResult<CheckedOut> {
  const head = await store.head(projectId);
  if (!head.ok) return head;
  await mkdir(workDir, { recursive: true });
  const workKey = resolve(workDir);
  let cache = workDirCache.get(workKey);
  if (!cache) {
    cache = new Map<string, CachedWorkFile>();
    workDirCache.set(workKey, cache);
  }

  const headFiles = (head.value?.files ?? []).filter((file) =>
    workspacePathSchema.safeParse(file.path).success,
  );
  const wantedFiles = new Set<string>();
  const wantedDirs = new Set<string>();
  for (const file of headFiles) {
    wantedFiles.add(file.path);
    let dir = dirname(file.path);
    while (dir && dir !== '.') {
      wantedDirs.add(dir);
      dir = dirname(dir);
    }
  }

  await cleanExtraneous(workDir, '', wantedFiles, wantedDirs, cache);
  for (const key of cache.keys()) {
    if (!wantedFiles.has(key)) cache.delete(key);
  }

  const files = new Map<string, BaseFile>();
  for (const file of headFiles) {
    const target = join(workDir, file.path);
    const info = await lstat(target).catch(() => null);
    let upToDate = false;
    if (
      info &&
      info.isFile() &&
      !info.isSymbolicLink() &&
      info.nlink === 1 &&
      (info.mode & 0o600) === 0o600 &&
      info.size === file.bytes
    ) {
      const cached = cache.get(file.path);
      if (
        cached &&
        cached.sha256 === file.sha256 &&
        cached.bytes === file.bytes &&
        cached.mtimeMs === info.mtimeMs
      ) {
        upToDate = true;
      } else {
        const existing = await readPlainFile(target, info);
        if (existing && sha256Of(existing) === file.sha256) {
          cache.set(file.path, { sha256: file.sha256, bytes: file.bytes, mtimeMs: info.mtimeMs });
          upToDate = true;
        }
      }
    }
    if (!upToDate) {
      if (info) {
        await rm(target, { recursive: true, force: true });
      }
      const data = await store.readBlob(projectId, file.sha256);
      if (!data.ok) return data;
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, data.value, { mode: 0o644 });
      const written = await lstat(target).catch(() => null);
      if (written) {
        cache.set(file.path, { sha256: file.sha256, bytes: file.bytes, mtimeMs: written.mtimeMs });
      } else {
        cache.delete(file.path);
      }
    }
    files.set(file.path, { sha256: file.sha256, bytes: file.bytes });
  }
  return ok({ revision: head.value?.revision ?? 0, files });
}

export type WorkChange =
  | {
      readonly path: string;
      readonly data: Uint8Array;
      readonly sha256: string;
      readonly change: 'added' | 'changed';
    }
  | { readonly path: string; readonly change: 'deleted' };

export interface NotKept {
  readonly path: string;
  readonly reason: string;
}

export interface ReadBack {
  readonly changes: readonly WorkChange[];
  /** At most MAX_NOT_KEPT, by path. */
  readonly notKept: readonly NotKept[];
  /** Every path not kept, named or not. */
  readonly notKeptCount: number;
}

const sha256Of = (data: Uint8Array) => createHash('sha256').update(data).digest('hex');

/** A regular file's bytes, if it is still the single-link file `walked` found there; null otherwise. */
async function readPlainFile(path: string, walked: { ino: number; dev: number }): Promise<Uint8Array | null> {
  const handle = await open(path, fsc.O_RDONLY | fsc.O_NOFOLLOW).catch(() => null);
  if (!handle) return null;
  try {
    const facts = await handle.stat();
    if (!facts.isFile() || facts.nlink !== 1 || facts.ino !== walked.ino || facts.dev !== walked.dev)
      return null;
    if (facts.size > WORKSPACE_LIMITS.fileBytes) return null;
    return new Uint8Array(await handle.readFile());
  } finally {
    await handle.close();
  }
}

interface FoundWorkFile {
  readonly data: Uint8Array;
  readonly sha256: string;
  readonly mtimeMs: number;
}

/** What `work/` holds now against what was checked out. */
export async function readBack(workDir: string, base: CheckedOut): Promise<ReadBack> {
  const refused: NotKept[] = [];
  const found = new Map<string, FoundWorkFile>();
  const cache = workDirCache.get(resolve(workDir));
  const refuse = (path: string, reason: string) => {
    cache?.delete(path);
    refused.push({ path, reason });
  };
  const stack: string[] = [''];
  let walked = 0;
  while (stack.length > 0) {
    const rel = stack.pop()!;
    const entries = await readdir(join(workDir, rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries.sort((a, b) => (a.name < b.name ? 1 : -1))) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (++walked > MAX_WALK) {
        refuse(path, `more than ${MAX_WALK} entries in work/: the rest were not read`);
        stack.length = 0;
        break;
      }
      if (entry.name.startsWith('.')) {
        refuse(path, 'a hidden name: a workspace path is plain names');
        continue;
      }
      if (entry.isSymbolicLink()) {
        refuse(path, 'a link: only regular files are kept');
        continue;
      }
      if (entry.isDirectory()) {
        stack.push(path);
        continue;
      }
      if (!entry.isFile()) {
        refuse(path, 'not a regular file');
        continue;
      }
      if (path.startsWith(RESERVED_PREFIX)) {
        cache?.delete(path);
        continue;
      }
      if (!workspacePathSchema.safeParse(path).success) {
        refuse(path, 'not a workspace path: at most 8 plain names of letters, digits, ".", "-" and "_"');
        continue;
      }
      const facts = await lstat(join(workDir, path)).catch(() => null);
      if (!facts?.isFile()) continue;
      if (facts.size > WORKSPACE_LIMITS.fileBytes) {
        refuse(path, 'over 64 KB: a workspace file is text or a small asset; make media in out/');
        continue;
      }
      const data = await readPlainFile(join(workDir, path), facts);
      if (!data) {
        refuse(path, 'not a plain file (a hard link, or it changed while read)');
        continue;
      }
      found.set(path, { data, sha256: sha256Of(data), mtimeMs: facts.mtimeMs });
    }
  }
  return compare(base, found, refused, cache);
}

/** The changes, within the workspace's totals (kept in path order; what would pass them is named). */
function compare(
  base: CheckedOut,
  found: ReadonlyMap<string, FoundWorkFile>,
  refused: NotKept[],
  cache: Map<string, CachedWorkFile> | undefined,
): ReadBack {
  const changes: WorkChange[] = [];
  let files = 0;
  let bytes = 0;
  for (const [path, file] of base.files) {
    if (path.startsWith(RESERVED_PREFIX)) {
      files += 1;
      bytes += file.bytes;
    }
  }
  for (const path of [...found.keys()].sort()) {
    const file = found.get(path)!;
    if (
      files + 1 > WORKSPACE_LIMITS.workspaceFiles ||
      bytes + file.data.byteLength > WORKSPACE_LIMITS.workspaceBytes
    ) {
      cache?.delete(path);
      refused.push({ path, reason: 'the workspace is full (512 files, 2 MB): make media in out/' });
      continue;
    }
    files += 1;
    bytes += file.data.byteLength;
    cache?.set(path, { sha256: file.sha256, bytes: file.data.byteLength, mtimeMs: file.mtimeMs });
    const before = base.files.get(path);
    if (before?.sha256 === file.sha256) continue;
    changes.push({ path, data: file.data, sha256: file.sha256, change: before ? 'changed' : 'added' });
  }
  const refusedPaths = new Set(refused.map((entry) => entry.path));
  for (const path of [...base.files.keys()].sort()) {
    // A file the command removed is deleted; one it replaced with something not kept keeps its old version.
    if (path.startsWith(RESERVED_PREFIX) || found.has(path) || refusedPaths.has(path)) continue;
    cache?.delete(path);
    changes.push({ path, change: 'deleted' });
  }
  const notKept = refused.sort((a, b) => (a.path < b.path ? -1 : 1));
  return { changes, notKept: notKept.slice(0, MAX_NOT_KEPT), notKeptCount: notKept.length };
}
