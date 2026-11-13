// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The media files directly inside a source folder, by extension. Enough for
 * the gate demo to find "the first video"; the real indexer (Phase 2) walks
 * subfolders, hashes and probes.
 */
import { readdir, stat } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { FolderMissing, folderParams } from './errors';

export type MediaFileType = 'video' | 'image' | 'audio';

const TYPES: Readonly<Record<string, MediaFileType>> = Object.fromEntries([
  ...['mp4', 'mov', 'm4v', 'mkv', 'avi', 'webm', 'mts', 'm2ts', '3gp', 'mxf'].map((e) => [e, 'video']),
  ...['jpg', 'jpeg', 'png', 'heic', 'heif', 'webp', 'tif', 'tiff', 'dng', 'gif'].map((e) => [e, 'image']),
  ...['m4a', 'mp3', 'wav', 'aac', 'aif', 'aiff', 'flac', 'caf', 'ogg', 'opus'].map((e) => [e, 'audio']),
]);

export function mediaTypeOf(name: string): MediaFileType | undefined {
  return TYPES[extname(name).slice(1).toLowerCase()];
}

export interface MediaFile {
  readonly name: string;
  readonly path: string;
  readonly type: MediaFileType;
  readonly sizeBytes: number;
  /** Epoch milliseconds. */
  readonly modifiedAt: number;
}

export interface MediaListing {
  readonly files: MediaFile[];
  /** Media files in the folder, including those past the limit. */
  readonly total: number;
}

const byName = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * First-level media files in `folder`, sorted by name the way Finder does
 * (numbers in order), at most `limit`. Hidden files, subfolders and symlinks
 * are skipped: a link could point anywhere on the disk.
 */
export async function listMediaFiles(
  folder: string,
  limit: number,
  /** The source's label, to name the folder if it is gone. Default: the folder's own name. */
  label?: string,
): AsyncResult<MediaListing> {
  let entries;
  try {
    entries = await readdir(folder, { withFileTypes: true });
  } catch {
    return err(FolderMissing(folderParams(folder, label)));
  }
  const media = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.') && mediaTypeOf(e.name))
    .map((e) => e.name)
    .sort(byName.compare);
  const files: MediaFile[] = [];
  for (const name of media.slice(0, Math.max(0, limit))) {
    const path = join(folder, name);
    const info = await stat(path).catch(() => undefined);
    if (!info) continue; // Deleted between the listing and now.
    files.push({
      name,
      path,
      type: mediaTypeOf(name)!,
      sizeBytes: info.size,
      modifiedAt: Math.round(info.mtimeMs),
    });
  }
  return ok({ files, total: media.length });
}
