// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { openAsBlob } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { basename, extname, isAbsolute } from 'node:path';
import {
  CancelledError,
  err,
  NotFoundError,
  ok,
  parseId,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type RenderStore,
} from '@taalcut/core';
import type { OpenPluginUpload, UploadInput } from '@taalcut/tools';

export interface PluginUploadMedia {
  assetPath(id: AssetId): string | undefined;
  renders: Pick<RenderStore, 'get'>;
}

export type ResolvePluginMediaPath = (input: UploadInput, signal: AbortSignal) => AsyncResult<string>;

const MIME: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.avif': 'image/avif',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
};
const missing = () => err(NotFoundError({ entity: 'plugin-media' }));
const invalid = () => err(ValidationError({ field: 'media' }));

async function mediaPath(media: PluginUploadMedia, input: UploadInput): AsyncResult<string> {
  if (Object.keys(input).some((key) => !['assetId', 'renderId', 'expectedSha256'].includes(key)))
    return invalid();
  if (input.expectedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(input.expectedSha256)) return invalid();
  if ((input.assetId !== undefined) === (input.renderId !== undefined)) return invalid();
  if (input.assetId !== undefined) {
    const id = parseId<'Asset'>(input.assetId);
    if (!id.ok) return id;
    const path = media.assetPath(id.value);
    return path ? ok(path) : missing();
  }
  const id = parseId<'Render'>(input.renderId);
  if (!id.ok) return id;
  const render = await media.renders.get(id.value);
  if (!render.ok) return render;
  return render.value.status === 'ready' && render.value.deletedAt === null && render.value.filePath
    ? ok(render.value.filePath)
    : missing();
}

async function openValidatedMedia(
  media: PluginUploadMedia,
  input: UploadInput,
  signal: AbortSignal,
): AsyncResult<{ readonly path: string; readonly file: Blob }> {
  if (signal.aborted) return err(CancelledError());
  try {
    const resolved = await mediaPath(media, input);
    if (!resolved.ok) return resolved;
    const path = resolved.value;
    const mime = MIME[extname(path).toLowerCase()];
    if (!isAbsolute(path) || !mime) return invalid();
    const info = await lstat(path);
    if (!info.isFile() || info.size === 0 || info.size > 2 * 1024 ** 3) return invalid();
    // openAsBlob streams and checks the file's metadata before each read, refusing changed content.
    const file = await openAsBlob(path, { type: mime });
    if (input.expectedSha256) {
      const hash = createHash('sha256');
      for await (const chunk of file.stream()) {
        if (signal.aborted) return err(CancelledError());
        hash.update(chunk);
      }
      if (hash.digest('hex') !== input.expectedSha256) return invalid();
    }
    if (signal.aborted) return err(CancelledError());
    return ok({ path, file });
  } catch {
    return missing();
  }
}

/** Only existing app media IDs resolve to files. The provider never chooses a filesystem path. */
export function createPluginUploadReader(media: PluginUploadMedia): OpenPluginUpload {
  return async (input, signal) => {
    const opened = await openValidatedMedia(media, input, signal);
    if (!opened.ok) return opened;
    return ok({ file: opened.value.file, name: basename(opened.value.path) });
  };
}

/** Resolves a verified library asset or completed render ID to its local file path for local-only plugins (e.g. Instagram Edits). */
export function createPluginMediaPathResolver(media: PluginUploadMedia): ResolvePluginMediaPath {
  return async (input, signal) => {
    const opened = await openValidatedMedia(media, input, signal);
    if (!opened.ok) return opened;
    return ok(opened.value.path);
  };
}
