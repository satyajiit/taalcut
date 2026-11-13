// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Paths inside an experiment. Everything the sandbox hands a child is a real
 * path (Seatbelt matches resolved vnode paths, so `/tmp` must be `/private/tmp`),
 * and every relative path is checked after realpath so a symlink can't lead out.
 */
import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';

/** The manifest's name: never a child's output, and write-protected by the profiles. */
export const MANIFEST_FILE = 'experiment.json';
/** Ephemeral Netscape cookies file staged only for yt-dlp; never readable or writable via sandbox tools. */
export const COOKIES_FILE = 'ig-cookies.txt';
/** TMPDIR for the child. Not reported as written. */
export const TMP_DIR = 'tmp';
export const SCRATCH_PREFIX = 'scratch:';
export const INPUT_PREFIX = 'input:';
const MAX_RELATIVE = 512;

/** True when `child` is `parent` or inside it (both absolute, already resolved). */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

/** Why a relative path can't name a file in an experiment, or null when it can. */
export function relativeProblem(rel: string): string | null {
  if (rel.length === 0) return 'empty path';
  if (rel.length > MAX_RELATIVE) return 'path too long';
  // eslint-disable-next-line no-control-regex -- NUL and control characters never belong in a path
  if (/[\u0000-\u001f]/.test(rel)) return 'control character in path';
  if (isAbsolute(rel) || rel.startsWith('~')) return 'absolute path';
  const parts = rel.split(/[/\\]/);
  if (parts.some((part) => part === '..')) return "'..' in path";
  if (parts.some((part, i) => part === '' && i < parts.length - 1)) return 'empty path segment';
  if (parts[0] === MANIFEST_FILE || parts[0] === COOKIES_FILE) return 'reserved name';
  return null;
}

/** The nearest existing ancestor's real path, plus the part below it that doesn't exist yet. */
async function resolveExisting(path: string): Promise<{ real: string; rest: string }> {
  let current = path;
  const rest: string[] = [];
  for (;;) {
    try {
      const real = await realpath(current);
      return { real, rest: rest.reverse().join(sep) };
    } catch {
      const parent = dirname(current);
      if (parent === current) return { real: current, rest: rest.reverse().join(sep) };
      rest.push(current.slice(parent.length + 1));
      current = parent;
    }
  }
}

/**
 * The absolute real path of `rel` inside `dir` (which must already be real),
 * or null when it would leave the folder through `..` or a symlink.
 */
export async function resolveInside(dir: string, rel: string): Promise<string | null> {
  if (relativeProblem(rel) !== null) return null;
  const { real, rest } = await resolveExisting(join(dir, rel));
  const full = rest ? join(real, rest) : real;
  return isInside(dir, real) && isInside(dir, full) ? full : null;
}

export interface FileStamp {
  readonly bytes: number;
  readonly mtimeMs: number;
}

/**
 * Every regular file under `dir`, keyed by its path relative to `dir`, with
 * symlinks listed but never followed. `limit` caps the walk for huge folders.
 */
export async function walkFiles(dir: string, limit = 100_000): Promise<Map<string, FileStamp>> {
  const files = new Map<string, FileStamp>();
  const stack = [''];
  while (stack.length > 0 && files.size < limit) {
    const rel = stack.pop()!;
    let entries;
    try {
      entries = await readdir(join(dir, rel), { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) stack.push(path);
      else if (entry.isFile()) {
        const info = await lstat(join(dir, path)).catch(() => null);
        if (info) files.set(path, { bytes: info.size, mtimeMs: info.mtimeMs });
      }
    }
  }
  return files;
}

/** Bytes of every regular file under `dir`. */
export async function folderBytes(dir: string): Promise<number> {
  let total = 0;
  for (const file of (await walkFiles(dir)).values()) total += file.bytes;
  return total;
}

/** A path and whether it is a regular file, without throwing. */
export async function isFile(path: string): Promise<boolean> {
  const info = await stat(path).catch(() => null);
  return info?.isFile() ?? false;
}
