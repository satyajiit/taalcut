// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { MEDIA_HOST, type AsyncResult } from '@taalcut/core';
import { APP_SCHEME } from '../runtime';
import { fileUnderRoot } from './root-file';

export interface ImportPreviewRequest {
  readonly url: string;
  readonly method: string;
  readonly signal?: AbortSignal;
}
export type ImportPreviewHandler = (request: ImportPreviewRequest) => Promise<Response | undefined>;

export interface ImportPreviewOptions<T> {
  readonly rootDir: string;
  /** Resolve the opaque selection id from a durable draft, never from a path in the URL. */
  readonly resolve: (id: string) => AsyncResult<T | null>;
  readonly render: (source: T, dest: string, signal: AbortSignal) => AsyncResult<{ path: string | null }>;
}

const headers = {
  'Content-Type': 'image/jpeg',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'cross-origin',
  'Cache-Control': 'private, max-age=3600',
};
const matchId = /^\/import-preview\/([0-9A-HJKMNP-TV-Z]{26})\.jpg$/;
const maxBytes = 4 * 1024 * 1024;

async function previewFile(root: string, path: string): Promise<Buffer | null> {
  if (!fileUnderRoot(root)(path)) return null;
  const info = await stat(path).catch(() => null);
  if (!info?.isFile() || info.size <= 0 || info.size > maxBytes) return null;
  const bytes = await readFile(path).catch(() => null);
  return bytes?.[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? bytes : null;
}

/** Atomic cached previews with bounded local reads. Photos renderers always disable network access. */
export function createImportPreviewHandler<T>(options: ImportPreviewOptions<T>): ImportPreviewHandler {
  const root = resolve(options.rootDir);
  const pending = new Map<string, { controller: AbortController; waiters: number; done: Promise<boolean> }>();
  async function render(id: string, source: T, dest: string, signal?: AbortSignal): Promise<boolean> {
    let active = pending.get(id);
    if (!active) {
      const controller = new AbortController();
      const temp = join(root, `${id}-${randomUUID()}.incoming.jpg`);
      const done = (async () => {
        try {
          await mkdir(root, { recursive: true });
          const result = await options.render(source, temp, controller.signal);
          if (
            !result.ok ||
            result.value.path !== temp ||
            controller.signal.aborted ||
            !(await previewFile(root, temp))
          )
            return false;
          await rename(temp, dest);
          return true;
        } catch {
          return false;
        } finally {
          await rm(temp, { force: true }).catch(() => undefined);
          pending.delete(id);
        }
      })();
      active = { controller, waiters: 0, done };
      pending.set(id, active);
    }
    const job = active;
    job.waiters++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      if (--job.waiters === 0) job.controller.abort();
    };
    signal?.addEventListener('abort', release, { once: true });
    if (signal?.aborted) release();
    try {
      return await job.done;
    } finally {
      signal?.removeEventListener('abort', release);
      release();
    }
  }

  return async (request) => {
    if (!URL.canParse(request.url)) return undefined;
    const url = new URL(request.url);
    if (
      url.protocol !== `${APP_SCHEME}:` ||
      url.host !== MEDIA_HOST ||
      !url.pathname.startsWith('/import-preview/')
    )
      return undefined;
    const id = matchId.exec(url.pathname)?.[1];
    if (!id || url.search || url.hash || url.username || url.password)
      return new Response(null, { status: 404 });
    if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
    if (request.signal?.aborted) return new Response(null, { status: 499 });
    const source = await options.resolve(id);
    if (!source.ok || source.value === null) return new Response(null, { status: 404 });
    const path = join(root, `${id}.jpg`);
    let bytes = await previewFile(root, path);
    if (!bytes && request.method === 'GET' && (await render(id, source.value, path, request.signal)))
      bytes = await previewFile(root, path);
    if (!bytes) return new Response(null, { status: 404 });
    return new Response(request.method === 'HEAD' ? null : bytes, {
      status: 200,
      headers: { ...headers, 'Content-Length': String(bytes.byteLength) },
    });
  };
}
