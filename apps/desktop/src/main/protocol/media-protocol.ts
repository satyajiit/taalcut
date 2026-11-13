// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * app://media/<derived key>. Serves only keys that match DERIVED_KEY_PATTERN,
 * and only files whose real path stays inside the cache root. A read touches
 * the file's mtime (at most once per 10 minutes) so a later cache start sees
 * it as recently used. The jobs process owns eviction; this process only
 * updates the filesystem clock.
 *
 * Range requests get 206. The app scheme is not given corsEnabled or stream;
 * media elements send Range on the protocol request itself.
 */
import { createReadStream } from 'node:fs';
import { utimes } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { DERIVED_KEY_PATTERN, MEDIA_HOST } from '@taalcut/core';
import { APP_SCHEME } from '../runtime';
import { contentTypeFor } from './resolve';
import { fileSizeUnderRoot } from './root-file';

const TOUCH_GAP_MS = 10 * 60 * 1000;

export interface MediaHttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: { get(name: string): string | null };
}

export type MediaRequestPlan =
  | { readonly kind: 'skip' }
  | { readonly kind: 'error'; readonly status: 400 | 403 | 404 | 405 | 416; readonly size?: number }
  | {
      readonly kind: 'file';
      readonly path: string;
      readonly key: string;
      readonly contentType: string;
      readonly size: number;
      readonly range?: { readonly start: number; readonly end: number };
    };

export type ByteRange = { readonly start: number; readonly end: number };

/** Last touch per cache root and key. Main is one process, so this map is enough. */
const touchedAt = new Map<string, number>();
const sizeCheckers = new Map<string, (path: string) => number | undefined>();

export function planMediaRequest(
  request: MediaHttpRequest,
  rootDir: string,
  statFile: (path: string) => number | undefined,
): MediaRequestPlan {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return { kind: 'error', status: 400 };
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== MEDIA_HOST) return { kind: 'skip' };
  if (request.method !== 'GET' && request.method !== 'HEAD') return { kind: 'error', status: 405 };

  const key = derivedKey(url.pathname);
  if (key === undefined) return { kind: 'error', status: 400 };
  if (!DERIVED_KEY_PATTERN.test(key)) return { kind: 'error', status: 404 };

  const root = resolve(rootDir);
  const target = resolve(root, key);
  if (target !== root && !target.startsWith(root + sep)) return { kind: 'error', status: 403 };
  const size = statFile(target);
  if (size === undefined) return { kind: 'error', status: 404 };

  const header = request.headers.get('range');
  if (header === null || header.trim() === '') {
    return { kind: 'file', path: target, key, contentType: contentTypeFor(target), size };
  }
  const range = parseByteRange(header.trim(), size);
  if (range === undefined) return { kind: 'error', status: 416, size };
  return { kind: 'file', path: target, key, contentType: contentTypeFor(target), size, range };
}

/** Filesystem mtime, throttled. No-ops when the key was touched in the last 10 minutes. */
export function noteDerivedRead(rootDir: string, key: string, now = Date.now()): Promise<void> {
  const id = `${resolve(rootDir)}\0${key}`;
  const last = touchedAt.get(id) ?? 0;
  if (now - last < TOUCH_GAP_MS) return Promise.resolve();
  touchedAt.set(id, now);
  const root = resolve(rootDir);
  const abs = resolve(root, key);
  if (abs !== root && !abs.startsWith(root + sep)) return Promise.resolve();
  const when = new Date(now);
  return utimes(abs, when, when).then(
    () => undefined,
    () => undefined,
  );
}

/**
 * A response for host `media`, or undefined so the renderer handler continues.
 * `app://taalcut` and `app://media` are different origins, so the resource
 * policy is cross-origin. The page CSP already allows this host.
 */
export async function serveDerivedMedia(request: MediaHttpRequest, rootDir: string): Promise<Response | undefined> {
  const plan = planMediaRequest(request, rootDir, sizeUnderRoot(rootDir));
  if (plan.kind === 'skip') return undefined;
  if (plan.kind === 'error') {
    const headers = mediaHeaders('text/plain; charset=utf-8');
    if (plan.status === 416 && plan.size !== undefined) headers['Content-Range'] = `bytes */${plan.size}`;
    return new Response(null, { status: plan.status, headers });
  }
  void noteDerivedRead(rootDir, plan.key);
  const length = plan.range ? plan.range.end - plan.range.start + 1 : plan.size;
  const headers = mediaHeaders(plan.contentType);
  headers['Accept-Ranges'] = 'bytes';
  headers['Content-Length'] = String(length);
  if (plan.range) headers['Content-Range'] = `bytes ${plan.range.start}-${plan.range.end}/${plan.size}`;
  const status = plan.range ? 206 : 200;
  if (request.method === 'HEAD') return new Response(null, { status, headers });
  const node = createReadStream(plan.path, plan.range ? { start: plan.range.start, end: plan.range.end } : {});
  return new Response(Readable.toWeb(node) as ReadableStream<Uint8Array>, { status, headers });
}

export function mediaHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

function sizeUnderRoot(rootDir: string): (path: string) => number | undefined {
  const key = resolve(rootDir);
  let checker = sizeCheckers.get(key);
  if (!checker) {
    checker = fileSizeUnderRoot(key);
    sizeCheckers.set(key, checker);
  }
  return checker;
}

function derivedKey(pathname: string): string | undefined {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) return undefined;
  const key = (decoded.startsWith('/') ? decoded.slice(1) : decoded).replace(/\/+$/, '');
  if (key === '' || key.split('/').some((segment) => segment.startsWith('.'))) return undefined;
  return key;
}

/** One `bytes=` range. Multiple ranges and inverted ranges are rejected. */
export function parseByteRange(header: string, size: number): ByteRange | undefined {
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match) return undefined;
  const startText = match[1] ?? '';
  const endText = match[2] ?? '';
  if (startText === '' && endText === '') return undefined;
  if (size <= 0) return undefined;
  if (startText === '') {
    const suffix = Number(endText);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return undefined;
    const length = Math.min(suffix, size);
    return { start: size - length, end: size - 1 };
  }
  const start = Number(startText);
  if (!Number.isSafeInteger(start) || start >= size) return undefined;
  const end = endText === '' ? size - 1 : Math.min(Number(endText), size - 1);
  if (!Number.isSafeInteger(end) || end < start) return undefined;
  return { start, end };
}
