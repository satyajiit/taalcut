// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Maps an app://preview request to a file (packages/render SPEC section 5,
 * "Serving"). Pure (the file checks are injected) so the rules are
 * unit-tested:
 *
 * - Only GET and HEAD, only host "preview".
 * - The first segment is a session token: 32 lowercase hex characters naming
 *   <previewRoot>/<token>/. Anything else is a 404, so tokens can't be probed
 *   for paths.
 * - The rest is a file in that folder (no "..", no dot-files, no symlink
 *   leaving it), or an entry of the folder's manifest.json that points at a
 *   file under one of the allowed roots (the preview cache, the media cache,
 *   the bundled fonts, the renders folder), or (HFW1-WS) a project's
 *   workspace blob (preview-workspace.ts). The manifest itself is never
 *   served: it holds paths, and paths never reach a page.
 */
import { posix, resolve, sep } from 'node:path';
import { PREVIEW_HOST } from '@taalcut/core';
import { APP_SCHEME } from '../runtime';
import { contentTypeFor } from '../protocol/resolve';
import { isWorkspaceBlobPath } from './preview-workspace';

export const PREVIEW_TOKEN_PATTERN = /^[0-9a-f]{32}$/;
export const PREVIEW_MANIFEST = 'manifest.json';

export type PreviewRequestPlan =
  | { readonly kind: 'file'; readonly path: string; readonly contentType: string }
  | { readonly kind: 'error'; readonly status: 400 | 403 | 404 | 405 };

export interface PreviewRoots {
  /** <cache>/render/preview: one folder per session token. */
  readonly preview: string;
  /** Where a manifest entry may point (the preview root is always one of them). */
  readonly allowed: readonly string[];
  /** HFW1-WS: `<userData>/workspaces`, whose project blobs (and nothing else in it) an entry may name. */
  readonly workspaces?: string;
}

export interface PreviewFiles {
  /** A regular file whose real path is inside `root` (fileUnderRoot). */
  isFileUnder(root: string, path: string): boolean;
  /** A regular file whose real path is exactly `path` under `root`'s real path: no link on the way. */
  isPlainFileUnder(root: string, path: string): boolean;
  isDirectory(path: string): boolean;
  /** The session's manifest.json as a map, or undefined when it is missing or malformed. */
  readManifest(path: string): Readonly<Record<string, string>> | undefined;
}

const error = (status: 400 | 403 | 404 | 405): PreviewRequestPlan => ({ kind: 'error', status });

/** The decoded path's segments, or a status for a malformed or escaping one. */
function segmentsOf(pathname: string): string[] | 400 | 403 {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return 400;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return 400;
  const segments = decoded.split('/').filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === '..' || segment === '.')) return 403;
  return segments;
}

function inside(root: string, target: string): boolean {
  const base = resolve(root);
  return target.startsWith(base.endsWith(sep) ? base : base + sep);
}

export function planPreviewRequest(
  request: { readonly url: string; readonly method: string },
  roots: PreviewRoots,
  files: PreviewFiles,
): PreviewRequestPlan {
  if (request.method !== 'GET' && request.method !== 'HEAD') return error(405);
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return error(400);
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== PREVIEW_HOST) return error(404);

  const segments = segmentsOf(url.pathname);
  if (typeof segments === 'number') return error(segments);
  const [token, ...rest] = segments;
  if (!token || !PREVIEW_TOKEN_PATTERN.test(token) || rest.length === 0) return error(404);
  if (rest.some((segment) => segment.startsWith('.'))) return error(404);

  const session = resolve(roots.preview, token);
  if (!files.isDirectory(session)) return error(404);
  const relative = posix.join(...rest);
  if (relative === PREVIEW_MANIFEST) return error(404);

  const target = resolve(session, relative);
  if (!inside(session, target)) return error(403);
  if (files.isFileUnder(session, target)) {
    return { kind: 'file', path: target, contentType: contentTypeFor(target) };
  }

  const manifest = files.readManifest(resolve(session, PREVIEW_MANIFEST));
  const mapped = manifest?.[relative];
  if (typeof mapped !== 'string') return error(404);
  const mappedPath = resolve(mapped);
  // A relative entry would resolve against main's cwd; only absolute paths under an allowed root count.
  if (mapped !== mappedPath && !mapped.startsWith('/')) return error(403);
  const allowed = [roots.preview, ...roots.allowed].some(
    (root) => inside(root, mappedPath) && files.isFileUnder(root, mappedPath),
  );
  if (allowed) return { kind: 'file', path: mappedPath, contentType: contentTypeFor(mappedPath) };
  const workspaces = roots.workspaces;
  if (
    workspaces &&
    isWorkspaceBlobPath(workspaces, mappedPath) &&
    files.isPlainFileUnder(workspaces, mappedPath)
  )
    return { kind: 'file', path: mappedPath, contentType: contentTypeFor(relative) };
  return error(403);
}

export type ByteRange = { readonly start: number; readonly end: number };

/**
 * One `bytes=` range against a file of `size` bytes: the inclusive range, 'unsatisfiable' (416), or
 * undefined for no or an unsupported header (multiple ranges): the whole file is served then.
 */
export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | undefined {
  if (!header) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return undefined;
  if (first === '') {
    // A suffix: the last n bytes.
    const length = Number(last);
    if (length === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - length), end: size - 1 };
  }
  const start = Number(first);
  const end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
  if (start >= size || end < start) return 'unsatisfiable';
  return { start, end };
}
