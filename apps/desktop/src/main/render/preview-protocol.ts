// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Serves app://preview (packages/render SPEC section 5): preview bundles,
 * the proxies and fonts they link, finished renders, posters and QA frames.
 * `<video>` needs HTTP Range, so files are streamed in byte ranges (206), not
 * read whole. Every response carries the preview page's own CSP and no-store.
 * No Electron here: app-protocol.ts calls servePreview for the preview host.
 */
import { createReadStream, readFileSync, realpathSync, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { PREVIEW_CSP, previewCsp } from '@taalcut/core';
import { APP_ORIGIN, type Runtime } from '../runtime';
import { fileUnderRoot } from '../protocol/root-file';
import { parseRange, planPreviewRequest, type PreviewFiles, type PreviewRoots } from './preview-resolve';

/**
 * The preview's CSP for this run: PREVIEW_CSP in a packaged app; in development the window may load
 * from the Vite dev server, which must be allowed to frame the player too (core drops any origin that
 * isn't app://taalcut or loopback http).
 */
export function previewCspFor(runtime: Pick<Runtime, 'packaged' | 'devServerOrigin'>): string {
  if (runtime.packaged || !runtime.devServerOrigin) return PREVIEW_CSP;
  return previewCsp({ frameAncestors: [APP_ORIGIN, runtime.devServerOrigin] });
}

/** Headers on every app://preview response. */
export function previewResponseHeaders(
  contentType: string,
  csp: string = PREVIEW_CSP,
): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': csp,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    // The app page (another origin) plays finished renders and shows posters from here.
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}

/** The real file system, with one fileUnderRoot check per root (it caches the root's real path). */
export function nodePreviewFiles(): PreviewFiles {
  const checks = new Map<string, (path: string) => boolean>();
  return {
    isFileUnder(root, path) {
      let check = checks.get(root);
      if (!check) {
        check = fileUnderRoot(root);
        checks.set(root, check);
      }
      return check(path);
    },
    isPlainFileUnder(root, path) {
      try {
        const expected = join(realpathSync(root), relative(resolve(root), path));
        const real = realpathSync(path);
        return real === expected && statSync(real).isFile();
      } catch {
        return false;
      }
    },
    isDirectory(path) {
      try {
        return statSync(path).isDirectory();
      } catch {
        return false;
      }
    },
    readManifest(path) {
      try {
        const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
        return Object.fromEntries(
          Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
        );
      } catch {
        return undefined;
      }
    },
  };
}

function status(code: number, csp: string, extra: Record<string, string> = {}): Response {
  return new Response(null, {
    status: code,
    headers: { ...previewResponseHeaders('text/plain; charset=utf-8', csp), ...extra },
  });
}

function body(path: string, range?: { start: number; end: number }): ReadableStream<Uint8Array> {
  const stream = createReadStream(path, range ? { start: range.start, end: range.end } : {});
  return Readable.toWeb(stream) as ReadableStream<Uint8Array>;
}

/** Answers one app://preview request. */
export async function servePreview(
  request: Pick<Request, 'url' | 'method' | 'headers'>,
  roots: PreviewRoots,
  files: PreviewFiles = nodePreviewFiles(),
  csp: string = PREVIEW_CSP,
): Promise<Response> {
  const plan = planPreviewRequest(request, roots, files);
  if (plan.kind === 'error') return status(plan.status, csp);
  let size: number;
  try {
    size = (await stat(plan.path)).size;
  } catch {
    return status(404, csp);
  }
  const headers = { ...previewResponseHeaders(plan.contentType, csp), 'Accept-Ranges': 'bytes' };
  const head = request.method === 'HEAD';
  const range = parseRange(request.headers.get('range'), size);
  if (range === 'unsatisfiable')
    return status(416, csp, { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' });
  if (range) {
    return new Response(head ? null : body(plan.path, range), {
      status: 206,
      headers: {
        ...headers,
        'Content-Range': `bytes ${range.start}-${range.end}/${size}`,
        'Content-Length': String(range.end - range.start + 1),
      },
    });
  }
  return new Response(head || size === 0 ? null : body(plan.path), {
    status: 200,
    headers: { ...headers, 'Content-Length': String(size) },
  });
}
