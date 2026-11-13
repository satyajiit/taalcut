// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The checks every request passes before anything else reads it (tools SPEC, "The HTTP surface"): one path,
 * the methods MCP uses, a loopback Host for the bound port (DNS rebinding), an Origin that is absent or this
 * server's own, never a cross-site browser fetch, JSON in and JSON or SSE out, and a declared size within bounds.
 * CLI clients send no Origin; a browser page can't fake Host, which is what stops a rebinding attack, and the
 * bearer is what stops a local process.
 */
import type { IncomingHttpHeaders } from 'node:http';

export interface GuardRequest {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
  readonly headers: IncomingHttpHeaders;
}

export interface Rejection {
  readonly status: number;
  /** A JSON-RPC error without an id, for the 403s the spec asks to explain. */
  readonly body?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export const MCP_PATH = '/mcp';
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost']);

function header(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name];
  return Array.isArray(value) ? value.join(', ') : value;
}

function forbidden(message: string): Rejection {
  return {
    status: 403,
    body: JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message } }),
    headers: { 'content-type': 'application/json' },
  };
}

/** `127.0.0.1:41730` → ok for port 41730; a missing port or another one is not. */
export function hostAllowed(host: string | undefined, port: number): boolean {
  if (!host) return false;
  let parsed: URL;
  try {
    parsed = new URL(`http://${host}`);
  } catch {
    return false;
  }
  return LOOPBACK_HOSTS.has(parsed.hostname) && parsed.port === String(port) && parsed.pathname === '/';
}

export function originAllowed(origin: string | undefined, port: number): boolean {
  if (origin === undefined) return true;
  return origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`;
}

function mediaType(value: string | undefined): string {
  return (value ?? '').split(';')[0]?.trim().toLowerCase() ?? '';
}

function accepts(value: string | undefined, type: string): boolean {
  return (value ?? '')
    .split(',')
    .map((part) => mediaType(part))
    .some((part) => part === type || part === '*/*');
}

export function guardRequest(
  request: GuardRequest,
  port: number,
  maxBodyBytes: number,
): Rejection | undefined {
  const path = (request.url ?? '').split('?')[0];
  if (path !== MCP_PATH) return { status: 404 };
  const { headers } = request;
  if (!hostAllowed(header(headers, 'host'), port)) return forbidden('Host not allowed');
  if (!originAllowed(header(headers, 'origin'), port)) return forbidden('Origin not allowed');
  if (header(headers, 'sec-fetch-site') === 'cross-site') return forbidden('Cross-site request');
  const method = (request.method ?? '').toUpperCase();
  // No CORS: a preflight from a page is refused outright.
  if (method === 'OPTIONS') return forbidden('Not available to web pages');
  // No standalone server stream in either revision; DELETE ends a 2025 protocol session.
  if (method === 'GET') return { status: 405, headers: { allow: 'POST, DELETE' } };
  if (method === 'DELETE') return undefined;
  if (method !== 'POST') return { status: 405, headers: { allow: 'POST, DELETE' } };
  if (mediaType(header(headers, 'content-type')) !== 'application/json') return { status: 415 };
  const accept = header(headers, 'accept');
  if (!accepts(accept, 'application/json') || !accepts(accept, 'text/event-stream')) return { status: 406 };
  const length = Number(header(headers, 'content-length') ?? '0');
  if (!Number.isFinite(length) || length > maxBodyBytes) return { status: 413 };
  return undefined;
}
