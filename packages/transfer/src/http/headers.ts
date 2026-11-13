// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ServerResponse } from 'node:http';

const SECURITY: Readonly<Record<string, string>> = {
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'",
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
  'Cache-Control': 'no-store',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export function applySecurityHeaders(res: ServerResponse): void {
  for (const [name, value] of Object.entries(SECURITY)) res.setHeader(name, value);
}

export function reply(
  res: ServerResponse,
  status: number,
  body: string | Uint8Array,
  type?: string,
  extra?: Readonly<Record<string, string | number>>,
): void {
  if (res.writableEnded) return;
  applySecurityHeaders(res);
  if (type) res.setHeader('Content-Type', type);
  if (extra) {
    for (const [name, value] of Object.entries(extra)) res.setHeader(name, value);
  }
  res.statusCode = status;
  res.end(body);
}

export function clientAddress(remote: string | undefined): string {
  if (!remote) return 'unknown';
  return remote.startsWith('::ffff:') ? remote.slice('::ffff:'.length) : remote;
}
