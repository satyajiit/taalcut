// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { CancelledError, err, ok, toTaalcutError, type AsyncResult } from '@taalcut/core';
import { isPlaceholder, type PlaceholderStatus } from '../../sources/volumes';
import { captureFileName, isImportableFile, type CaptureFile } from './camera-profiles';
import { ImportSelectionUnavailable, ImportSourceChanged } from './errors';

export interface LocalInventory {
  readonly files: readonly CaptureFile[];
  readonly skipped: readonly {
    readonly name: string;
    readonly reason: 'placeholder' | 'unsupported' | 'symlink';
  }[];
}

/** Directory packages and hidden system files are never footage roots. */
const skipDirectory = (name: string) =>
  name.startsWith('.') || /\.(photoslibrary|photolibrary|app|bundle)$/i.test(name);

export async function inventoryLocalMedia(
  paths: readonly string[],
  options: {
    readonly recursive?: boolean;
    readonly placeholders?: PlaceholderStatus;
    readonly signal?: AbortSignal;
  } = {},
): AsyncResult<LocalInventory> {
  const files: CaptureFile[] = [];
  const skipped: { name: string; reason: 'placeholder' | 'unsupported' | 'symlink' }[] = [];
  const visited = new Set<string>();
  const queue = paths.map((path) => ({ path: resolve(path), depth: 0 }));
  try {
    for (let at = 0; at < queue.length; at++) {
      if (options.signal?.aborted) return err(CancelledError());
      const { path, depth } = queue[at]!;
      if (path.split('/').some((part) => /\.(photoslibrary|photolibrary|app|bundle)$/i.test(part))) continue;
      const info = await lstat(path);
      const name = captureFileName(path);
      if (info.isSymbolicLink()) {
        skipped.push({ name, reason: 'symlink' });
        continue;
      }
      const canonical = await realpath(path);
      if (visited.has(canonical)) continue;
      visited.add(canonical);
      if (info.isDirectory()) {
        if (skipDirectory(basename(path))) continue;
        if (depth > 0 && options.recursive === false) continue;
        const children = await readdir(path, { withFileTypes: true });
        children.sort((a, b) => a.name.localeCompare(b.name));
        for (const child of children) {
          if (!child.name.startsWith('.')) queue.push({ path: join(path, child.name), depth: depth + 1 });
        }
        continue;
      }
      if (!info.isFile() || !isImportableFile(name) || info.size === 0) {
        skipped.push({ name, reason: 'unsupported' });
        continue;
      }
      if (await isPlaceholder(canonical, info, options.placeholders)) {
        skipped.push({ name, reason: 'placeholder' });
        continue;
      }
      files.push({
        key: canonical,
        path: canonical,
        name,
        sizeBytes: info.size,
        modifiedAt: info.mtimeMs,
        fileId: info.ino,
      });
    }
    return ok({ files, skipped });
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

export function sameLocalFile(
  file: CaptureFile,
  info: { size: number; mtimeMs: number; ino: number },
): boolean {
  return file.sizeBytes === info.size && file.modifiedAt === info.mtimeMs && file.fileId === info.ino;
}

/** Open without following a replaced symlink, then validate the actual handle before any source read. */
export async function openSelectedOriginal(file: CaptureFile) {
  try {
    const handle = await open(file.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const info = await handle.stat();
    if (!info.isFile() || !sameLocalFile(file, info)) {
      await handle.close();
      return err(ImportSourceChanged());
    }
    return ok(handle);
  } catch {
    return err(ImportSelectionUnavailable());
  }
}
