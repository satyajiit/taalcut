// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * app://media/template-reel/<templateId> (BRK1-CMD): a template's kept reel (REF1's `reference.mp4`), for the
 * review's player. Main asks the library's template media store on every request, so a window reads only the file
 * the store names for a template it has, and only while that file is inside the template's own media folder (a
 * symlink out of it is refused). Byte ranges as the derived files, so a `<video>` seeks. Read-only: nothing here
 * writes. Anything else under `template-reel/` (a bad id, a query, a second segment, a template without media, a
 * file of another type) is a 404.
 */
import { createReadStream } from 'node:fs';
import { realpath, stat } from 'node:fs/promises';
import { extname, join, sep } from 'node:path';
import { Readable } from 'node:stream';
import {
  MEDIA_HOST,
  parseId,
  TEMPLATE_REEL_KEY_PATTERN,
  type Container,
  type TemplateId,
  type TemplateMediaStore,
} from '@taalcut/core';
import { createTemplateMediaStore } from '@taalcut/library';
import { templatesRoot } from '../../shared/template-assets';
import { LibraryDatabaseToken } from '../../shared/tokens';
import { APP_SCHEME } from '../runtime';
import { mediaHeaders, parseByteRange, type MediaHttpRequest } from './media-protocol';

const PREFIX = 'template-reel/';

/** What a kept reel can be (REF1 keeps the fetch's or the person's file as it came); Chromium plays these. */
const TYPES: Readonly<Record<string, string>> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
};

/** A template's kept reel as an absolute path, or undefined when there is none to serve. */
export type ReelOf = (templateId: TemplateId) => Promise<string | undefined>;

/**
 * The kept reel's real path, only when it is a file inside `<templates root>/media/<templateId>/` once every
 * symlink is resolved: the store's row names a plain file name, and this keeps a link planted in the folder from
 * reaching anything else.
 */
export async function keptReelPath(
  store: Pick<TemplateMediaStore, 'get'>,
  root: string,
  templateId: TemplateId,
): Promise<string | undefined> {
  const kept = await store.get(templateId).catch(() => undefined);
  if (!kept?.ok || !kept.value) return undefined;
  try {
    const folder = await realpath(join(root, 'media', templateId));
    const file = await realpath(kept.value.path);
    if (!file.startsWith(folder + sep)) return undefined;
    return (await stat(file)).isFile() ? file : undefined;
  } catch {
    // Gone between the store's answer and here: the review says the reel can't play.
    return undefined;
  }
}

/** The library's answer once main's container is composed; nothing before (no window is open yet). */
export function libraryTemplateReels(userData: string): {
  readonly resolve: ReelOf;
  bind(container: Container): void;
} {
  const root = templatesRoot(userData);
  let store: Pick<TemplateMediaStore, 'get'> | undefined;
  return {
    resolve: async (templateId) => (store ? keptReelPath(store, root, templateId) : undefined),
    bind(container) {
      store = createTemplateMediaStore(container.resolve(LibraryDatabaseToken), { templatesRoot: root });
    },
  };
}

function refuse(status: 404 | 405 | 416, size?: number): Response {
  const headers = mediaHeaders('text/plain; charset=utf-8');
  if (status === 416 && size !== undefined) headers['Content-Range'] = `bytes */${size}`;
  return new Response(null, { status, headers });
}

/** A response for app://media/template-reel/…, or undefined for any other URL. */
export async function serveTemplateReel(
  request: MediaHttpRequest,
  reelOf: ReelOf,
): Promise<Response | undefined> {
  if (!URL.canParse(request.url)) return undefined;
  const url = new URL(request.url);
  const key = url.pathname.replace(/^\/+/, '');
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== MEDIA_HOST || !key.startsWith(PREFIX))
    return undefined;
  if (request.method !== 'GET' && request.method !== 'HEAD') return refuse(405);
  // No parameter of any kind: the template's id and nothing else.
  if (url.search !== '' || url.hash !== '' || !TEMPLATE_REEL_KEY_PATTERN.test(key)) return refuse(404);
  const id = parseId<'Template'>(key.slice(PREFIX.length));
  const path = id.ok ? await reelOf(id.value) : undefined;
  const type = path ? TYPES[extname(path).toLowerCase()] : undefined;
  const size =
    path && type
      ? await stat(path).then(
          (found) => (found.isFile() ? found.size : undefined),
          () => undefined,
        )
      : undefined;
  if (!path || !type || size === undefined || size === 0) return refuse(404);
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
