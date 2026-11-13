// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Maps an app:// request to a file in the renderer build. Pure (the file
 * check is injected) so traversal and fallback rules are unit-tested.
 *
 * - Only GET and HEAD, only host "taalcut".
 * - The path is decoded, normalised and must stay inside the root; encoded
 *   "..", backslashes, NUL bytes and dot-files are refused.
 * - A missing path without a file extension is an SPA route: serve index.html.
 *   A missing asset (has an extension) is a 404, so a broken build fails
 *   loudly instead of getting HTML back as JavaScript.
 */
import { extname, posix, resolve, sep } from 'node:path';
import { APP_HOST, APP_SCHEME } from '../runtime';

export type AppRequestPlan =
  | { readonly kind: 'file'; readonly path: string; readonly contentType: string }
  | { readonly kind: 'error'; readonly status: 400 | 403 | 404 | 405 };

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
};

export function contentTypeFor(path: string): string {
  return MIME_TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

export function planAppRequest(
  request: { readonly url: string; readonly method: string },
  rootDir: string,
  isFile: (path: string) => boolean,
): AppRequestPlan {
  if (request.method !== 'GET' && request.method !== 'HEAD') return { kind: 'error', status: 405 };

  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { kind: 'error', status: 400 };
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST) return { kind: 'error', status: 404 };

  const relative = decodePath(url.pathname);
  if (relative === undefined) return { kind: 'error', status: 400 };
  if (relative.split('/').some((segment) => segment.startsWith('.'))) return { kind: 'error', status: 404 };

  const root = resolve(rootDir);
  const index = resolve(root, 'index.html');
  const target = resolve(root, `.${relative}`);
  if (target !== root && !target.startsWith(root + sep)) return { kind: 'error', status: 403 };

  if (target !== root && isFile(target))
    return { kind: 'file', path: target, contentType: contentTypeFor(target) };
  if (extname(relative) === '' && isFile(index)) {
    return { kind: 'file', path: index, contentType: contentTypeFor(index) };
  }
  return { kind: 'error', status: 404 };
}

/** Decoded, normalised absolute path ("/a/b"), or undefined if it is malformed or escapes "/". */
function decodePath(pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return undefined;
  if (decoded.split('/').includes('..')) return undefined;
  return posix.normalize(decoded.startsWith('/') ? decoded : `/${decoded}`);
}
