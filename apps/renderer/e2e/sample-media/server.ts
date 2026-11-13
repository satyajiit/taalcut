// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Serves the fake backend's sample media (this folder: the clip page's proxies and stills, UX2) at
 * /fake-media/<file> in `vite dev` and `vite preview`, in byte ranges as main serves app://media, so the fake's
 * <video> seeks the way the app's does. Never part of the build: the desktop app has the real media. It lives
 * here, beside the files and their generator (make.mjs), as Node tooling for vite.config.ts, not app code.
 */
import { createReadStream, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import type { Connect, Plugin } from 'vite';

export const SAMPLE_MEDIA_PATH = '/fake-media/';
const FOLDER = import.meta.dirname;
const TYPES: Readonly<Record<string, string>> = { mp4: 'video/mp4', jpg: 'image/jpeg' };
const NAME = /^([a-z0-9-]{1,40})\.(mp4|jpg)$/;

/** One `bytes=start-end` range inside the file, or null for a header that asks for none or for more than one. */
function byteRange(header: string | undefined, size: number): { start: number; end: number } | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header?.trim() ?? '');
  if (!match || size <= 0 || (match[1] === '' && match[2] === '')) return null;
  if (match[1] === '') {
    const length = Math.min(Number(match[2]), size);
    return length > 0 ? { start: size - length, end: size - 1 } : null;
  }
  const start = Number(match[1]);
  const end = match[2] === '' ? size - 1 : Math.min(Number(match[2]), size - 1);
  return start < size && end >= start ? { start, end } : null;
}

function serve(request: IncomingMessage, response: ServerResponse, next: Connect.NextFunction): void {
  const url = request.url ?? '';
  if (!url.startsWith(SAMPLE_MEDIA_PATH)) return next();
  const match = NAME.exec(url.slice(SAMPLE_MEDIA_PATH.length).split('?')[0] ?? '');
  const file = match ? join(FOLDER, match[0]) : null;
  const size = file ? statSync(file, { throwIfNoEntry: false })?.size : undefined;
  if (!match || !file || size === undefined) {
    response.statusCode = 404;
    response.end();
    return;
  }
  const header = request.headers.range;
  const range = header ? byteRange(header, size) : null;
  if (header && !range) {
    response.writeHead(416, { 'Content-Range': `bytes */${size}` });
    response.end();
    return;
  }
  response.writeHead(range ? 206 : 200, {
    'Content-Type': TYPES[match[2] ?? ''] ?? 'application/octet-stream',
    'Accept-Ranges': 'bytes',
    'Content-Length': String(range ? range.end - range.start + 1 : size),
    ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${size}` } : {}),
  });
  if (request.method === 'HEAD') {
    response.end();
    return;
  }
  createReadStream(file, range ?? {}).pipe(response);
}

export function sampleMedia(): Plugin {
  return {
    name: 'taalcut:sample-media',
    configureServer(server) {
      server.middlewares.use(serve);
    },
    configurePreviewServer(server) {
      server.middlewares.use(serve);
    },
  };
}
