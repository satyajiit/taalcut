// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Walking a watched folder (P2-L2): depth first, each folder's entries in
 * code-unit order, so the walk visits relative paths in one total order
 * (segment by segment) and a scan stopped by a quit resumes after the last
 * path it finished. Symlinks are never followed (a link could point anywhere
 * on the disk); hidden files, AppleDouble `._*` files, app and library
 * bundles and anything that isn't media are skipped.
 */
import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { mediaTypeOf } from './media-files';

/** Packages a scan never descends into: their insides belong to another app. */
export const BUNDLE_EXTENSIONS: ReadonlySet<string> = new Set([
  '.photoslibrary',
  '.fcpbundle',
  '.imovielibrary',
  '.app',
  '.lrdata',
]);

/** Hidden (dot files, AppleDouble `._*`) or a bundle: never part of a scan. */
export function isIgnoredSegment(name: string): boolean {
  return name.startsWith('.') || BUNDLE_EXTENSIONS.has(extname(name).toLowerCase());
}

/** A relative path is scanned when no segment is ignored and the file is media. */
export function isScannable(relativePath: string): boolean {
  const segments = relativePath.split('/');
  return (
    segments.every((s) => s !== '' && !isIgnoredSegment(s)) && mediaTypeOf(segments.at(-1)!) !== undefined
  );
}

/** The walk's order: segment by segment, each by UTF-16 code unit. */
export function compareRelative(a: string, b: string): number {
  const x = a.split('/');
  const y = b.split('/');
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    if (x[i] !== y[i]) return x[i]! < y[i]! ? -1 : 1;
  }
  return x.length - y.length;
}

/** Entries by NFC name in code-unit order: stored paths are NFC, so resume compares like with like. */
function sorted(entries: Dirent[]): { entry: Dirent; name: string }[] {
  return entries
    .map((entry) => ({ entry, name: entry.name.normalize('NFC') }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export interface WalkEntry {
  /** '/'-separated, relative to the walk's root. */
  readonly relativePath: string;
  readonly absolutePath: string;
}

export interface WalkOptions {
  readonly recursive?: boolean;
  /** Resume: only paths after this one (compareRelative) are visited. */
  readonly after?: string | null;
  readonly signal?: AbortSignal;
  /** Called for a folder that couldn't be read (permission, vanished); the walk goes on without it. */
  readonly onUnreadable?: (relativePath: string, cause: NodeJS.ErrnoException) => void;
}

/** Whether a folder may still hold paths after `after`: it is a prefix of it, or comes after it. */
function worthEntering(folder: string, after: string | null | undefined): boolean {
  if (!after) return true;
  return after.startsWith(`${folder}/`) || compareRelative(folder, after) > 0;
}

/** Media files under `root` in walk order. The root itself must be readable (the caller checks). */
export async function* walkMedia(root: string, options: WalkOptions = {}): AsyncGenerator<WalkEntry> {
  yield* walkFolder(root, '', options);
}

async function* walkFolder(root: string, folder: string, options: WalkOptions): AsyncGenerator<WalkEntry> {
  if (options.signal?.aborted) return;
  let entries: Dirent[];
  try {
    entries = await readdir(folder ? join(root, folder) : root, { withFileTypes: true });
  } catch (cause) {
    options.onUnreadable?.(folder, cause as NodeJS.ErrnoException);
    return;
  }
  for (const { entry, name } of sorted(entries)) {
    if (options.signal?.aborted) return;
    if (isIgnoredSegment(name)) continue;
    const relativePath = folder ? `${folder}/${name}` : name;
    if (entry.isDirectory()) {
      if (options.recursive !== false && worthEntering(relativePath, options.after))
        yield* walkFolder(root, relativePath, options);
    } else if (entry.isFile() && mediaTypeOf(name)) {
      if (options.after && compareRelative(relativePath, options.after) <= 0) continue;
      yield { relativePath, absolutePath: join(root, folder, entry.name) };
    }
    // Symlinks, sockets and the rest are skipped.
  }
}
