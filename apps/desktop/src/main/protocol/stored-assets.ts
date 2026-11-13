// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Content-addressed files the library stores, on app://media: template assets (a breakdown's contact sheet, core's
 * templateAssetUrl) at /templates/<sha256>.<jpg|webp>, and Style logos (core's styleAssetUrl) at
 * /styles/<sha256>.<png|jpg|webp>. The name is a sha256, nothing else, mapped through the library's own path
 * function into its store's folder; the file's real path must stay inside it. GET and HEAD, read-only, the same
 * headers as the derived files on this host.
 */
import { readFile } from 'node:fs/promises';
import { MEDIA_HOST, STYLE_ASSET_KEY_PATTERN, TEMPLATE_ASSET_KEY_PATTERN } from '@taalcut/core';
import { styleAssetPath, templateAssetPath } from '@taalcut/library';
import { APP_SCHEME } from '../runtime';
import { fileUnderRoot } from './root-file';

/** One kind of stored asset: its URL folder, the names core allows and where the library keeps the file. */
export interface StoredAssetKind {
  readonly folder: string;
  readonly pattern: RegExp;
  readonly types: Readonly<Record<string, string>>;
  readonly pathOf: (dir: string, sha256: string) => string;
}

export const TEMPLATE_ASSETS: StoredAssetKind = {
  folder: 'templates',
  pattern: TEMPLATE_ASSET_KEY_PATTERN,
  types: { jpg: 'image/jpeg', webp: 'image/webp' },
  pathOf: templateAssetPath,
};

export const STYLE_ASSETS: StoredAssetKind = {
  folder: 'styles',
  pattern: STYLE_ASSET_KEY_PATTERN,
  types: { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' },
  pathOf: styleAssetPath,
};

export type StoredAssetPlan =
  | { readonly kind: 'skip' }
  | { readonly kind: 'error'; readonly status: 404 | 405 }
  | { readonly kind: 'file'; readonly path: string; readonly contentType: string };

/** 'skip' for anything outside app://media/<folder>/…, so the next handler answers it. */
export function planStoredAsset(
  request: { readonly url: string; readonly method: string },
  kind: StoredAssetKind,
  assetsDir: string,
  isFile: (path: string) => boolean,
): StoredAssetPlan {
  if (!URL.canParse(request.url)) return { kind: 'skip' };
  const url = new URL(request.url);
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== MEDIA_HOST) return { kind: 'skip' };
  if (!url.pathname.startsWith(`/${kind.folder}/`)) return { kind: 'skip' };
  if (request.method !== 'GET' && request.method !== 'HEAD') return { kind: 'error', status: 405 };
  const key = url.pathname.slice(1);
  if (!kind.pattern.test(key)) return { kind: 'error', status: 404 };
  const [sha256 = '', extension = ''] = key.slice(kind.folder.length + 1).split('.');
  const contentType = kind.types[extension];
  if (!contentType) return { kind: 'error', status: 404 };
  const path = kind.pathOf(assetsDir, sha256);
  if (!isFile(path)) return { kind: 'error', status: 404 };
  return { kind: 'file', path, contentType };
}

function headers(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
    // Content-addressed: a name never changes what it shows.
    'Cache-Control': 'private, max-age=31536000, immutable',
  };
}

/** A response for app://media/<kind's folder>/…, or undefined for every other URL. */
export function storedAssetHandler(kind: StoredAssetKind, assetsDir: string) {
  const isFile = fileUnderRoot(assetsDir);
  return async (request: {
    readonly url: string;
    readonly method: string;
  }): Promise<Response | undefined> => {
    const plan = planStoredAsset(request, kind, assetsDir, isFile);
    if (plan.kind === 'skip') return undefined;
    if (plan.kind === 'error')
      return new Response(null, { status: plan.status, headers: headers('text/plain; charset=utf-8') });
    let body: Buffer;
    try {
      body = await readFile(plan.path);
    } catch {
      return new Response(null, { status: 404, headers: headers('text/plain; charset=utf-8') });
    }
    return new Response(request.method === 'HEAD' ? null : new Uint8Array(body), {
      status: 200,
      headers: { ...headers(plan.contentType), 'Content-Length': String(body.byteLength) },
    });
  };
}

/** Template contact sheets on app://media/templates/…. */
export const templateAssetHandler = (assetsDir: string) => storedAssetHandler(TEMPLATE_ASSETS, assetsDir);

/** Style logos on app://media/styles/…. */
export const styleAssetHandler = (assetsDir: string) => storedAssetHandler(STYLE_ASSETS, assetsDir);
