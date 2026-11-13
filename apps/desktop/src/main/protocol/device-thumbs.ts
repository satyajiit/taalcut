// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * app://media/device/<deviceKey>/<itemKey>.jpg from
 * <userData>/transfer/usb/thumbs/<deviceKey>/<itemKey>.jpg (P3-B4).
 * GET and HEAD only. A path under /device/ that is not a thumb is 404,
 * not a fall-through to derived media.
 */
import { statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { DEVICE_THUMB_KEY_PATTERN, MEDIA_HOST } from '@taalcut/core';
import { APP_SCHEME } from '../runtime';
import { fileUnderRoot } from './root-file';

export interface DeviceThumbRequest {
  readonly url: string;
  readonly method: string;
}

export type DeviceThumbPlan =
  | { readonly kind: 'error'; readonly status: 403 | 404 | 405 }
  | { readonly kind: 'file'; readonly path: string; readonly size: number };

/** Undefined when the URL is not a device thumb (another host, or not under /device/). */
export function planDeviceThumb(request: DeviceThumbRequest, rootDir: string): DeviceThumbPlan | undefined {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return undefined;
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== MEDIA_HOST) return undefined;
  const parsed = devicePath(url.pathname);
  if (parsed.kind === 'skip') return undefined;
  if (parsed.kind === 'escape') return { kind: 'error', status: 403 };
  if (parsed.kind === 'invalid') return { kind: 'error', status: 404 };
  if (request.method !== 'GET' && request.method !== 'HEAD') return { kind: 'error', status: 405 };

  const root = resolve(rootDir);
  const target = resolve(root, parsed.relative);
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  if (!target.startsWith(prefix)) return { kind: 'error', status: 403 };
  if (!fileUnderRoot(rootDir)(target)) return { kind: 'error', status: 404 };
  try {
    return { kind: 'file', path: target, size: statSync(target).size };
  } catch {
    return { kind: 'error', status: 404 };
  }
}

export async function serveDeviceThumb(
  request: DeviceThumbRequest,
  rootDir: string,
): Promise<Response | undefined> {
  const plan = planDeviceThumb(request, rootDir);
  if (plan === undefined) return undefined;
  if (plan.kind === 'error') {
    return new Response(null, { status: plan.status, headers: thumbHeaders('text/plain; charset=utf-8') });
  }
  const headers = thumbHeaders('image/jpeg');
  headers['Content-Length'] = String(plan.size);
  if (request.method === 'HEAD') return new Response(null, { status: 200, headers });
  const body = await readFile(plan.path);
  return new Response(body, { status: 200, headers });
}

type DevicePath =
  | { readonly kind: 'skip' }
  | { readonly kind: 'escape' }
  | { readonly kind: 'invalid' }
  | { readonly kind: 'thumb'; readonly relative: string };

/** Same NUL, backslash, `..` and dot-segment checks as a derived key, then the thumb pattern. */
function devicePath(pathname: string): DevicePath {
  if (!pathname.startsWith('/device/')) return { kind: 'skip' };
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return { kind: 'invalid' };
  }
  if (decoded.includes('\0') || decoded.includes('\\') || decoded.split('/').includes('..')) {
    return { kind: 'escape' };
  }
  const key = (decoded.startsWith('/') ? decoded.slice(1) : decoded).replace(/\/+$/, '');
  if (key === '' || key.split('/').some((segment) => segment.startsWith('.'))) return { kind: 'invalid' };
  if (!DEVICE_THUMB_KEY_PATTERN.test(key)) return { kind: 'invalid' };
  return { kind: 'thumb', relative: key.slice('device/'.length) };
}

function thumbHeaders(contentType: string): Record<string, string> {
  return {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  };
}
