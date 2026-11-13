// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * app://media/originals/<assetId> (UX2): a clip's original for the clip page's viewer, when media.proxy kept it as
 * the clip's own proxy. Main asks the library each time (`playableOriginal`: only while the proxy stage says so and
 * a copy is present), so a window can't read any other file. Byte ranges as the derived files, so a `<video>` seeks.
 */
import { createReadStream, statSync } from 'node:fs';
import { extname } from 'node:path';
import { Readable } from 'node:stream';
import { MEDIA_HOST, ORIGINAL_MEDIA_KEY_PATTERN, parseId, type AssetId, type Container } from '@taalcut/core';
import { playableOriginal, type LibraryDatabase } from '@taalcut/library';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { APP_SCHEME } from '../runtime';
import { mediaHeaders, parseByteRange, type MediaHttpRequest } from './media-protocol';

const PREFIX = 'originals/';

/** MP4, M4V and MOV share one box structure; Chromium's demuxer reads all three as MP4 (media's isPreviewFriendly). */
const TYPES: Readonly<Record<string, string>> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/mp4' };

export type OriginalOf = (assetId: AssetId) => string | undefined;

/** The library's answer once main's container is composed; nothing before (no window is open yet). */
export function libraryOriginals(): { readonly resolve: OriginalOf; bind(container: Container): void } {
  let db: LibraryDatabase | undefined;
  return {
    resolve: (assetId) => (db ? playableOriginal(db, assetId) : undefined),
    bind(container) {
      db = container.resolve(LibraryDatabaseToken);
    },
  };
}

function sizeOf(path: string): number | undefined {
  try {
    const stat = statSync(path);
    return stat.isFile() ? stat.size : undefined;
  } catch {
    // Gone between the library's answer and the read (unplugged, moved): the viewer says it can't load.
    return undefined;
  }
}

function refuse(status: 400 | 404 | 405 | 416, size?: number): Response {
  const headers = mediaHeaders('text/plain; charset=utf-8');
  if (status === 416 && size !== undefined) headers['Content-Range'] = `bytes */${size}`;
  return new Response(null, { status, headers });
}

/** A response for app://media/originals/…, or undefined for any other URL. */
export function serveOriginalMedia(request: MediaHttpRequest, originalOf: OriginalOf): Response | undefined {
  if (!URL.canParse(request.url)) return undefined;
  const url = new URL(request.url);
  const key = url.pathname.replace(/^\/+/, '');
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== MEDIA_HOST || !key.startsWith(PREFIX)) return undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(405);
  const id = ORIGINAL_MEDIA_KEY_PATTERN.test(key) ? parseId<'Asset'>(key.slice(PREFIX.length)) : null;
  if (!id?.ok) return refuse(400);
  const path = originalOf(id.value);
  const type = path ? TYPES[extname(path).toLowerCase()] : undefined;
  const size = path && type ? sizeOf(path) : undefined;
  if (!path || !type || size === undefined) return refuse(404);
  const header = request.headers.get('range')?.trim() ?? '';
  const range = header === '' ? undefined : parseByteRange(header, size);
  if (header !== '' && !range) return refuse(416, size);
  const headers = mediaHeaders(type);
  headers['Accept-Ranges'] = 'bytes';
  headers['Content-Length'] = String(range ? range.end - range.start + 1 : size);
  if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`;
  const status = range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const node = createReadStream(path, range ? { start: range.start, end: range.end } : {});
  return new Response(Readable.toWeb(node) as ReadableStream<Uint8Array>, { status, headers });
}
