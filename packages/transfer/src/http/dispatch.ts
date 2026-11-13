// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from '@tus/server';
import { TRANSFER_LIMITS } from '../limits';
import type { PhoneAssets } from '../deps';
import { requestDevice } from './context';
import { applySecurityHeaders, clientAddress, reply } from './headers';

export type HttpResult = {
  readonly status: number;
  readonly body?: string;
  readonly type?: string;
  readonly retryAfter?: number;
};

export interface HttpHost {
  readonly address: string;
  readonly port: number;
  readonly assets: PhoneAssets;
  readonly tus: Server | null;
  /** Unauthenticated ceiling: 30 a minute per address. Null means the request may proceed. */
  allowPublic(ip: string): HttpResult | null;
  pair(ip: string, userAgent: string, body: unknown): Promise<HttpResult>;
  /** UX3: a phone with the QR's token asks a person on the computer to let it in, then waits for the answer. */
  askApproval(ip: string, userAgent: string, body: unknown): Promise<HttpResult>;
  waitApproval(ip: string, body: unknown): HttpResult;
  cancelApproval(ip: string, body: unknown): HttpResult;
  /** PATCH skips the authenticated API rate limit. */
  authorise(
    ip: string,
    credential: string | null,
    method: string,
  ): Promise<
    { readonly ok: true; readonly deviceId: string } | { readonly ok: false; readonly result: HttpResult }
  >;
  lookup(deviceId: string, body: unknown): Promise<HttpResult>;
  session(deviceId: string): HttpResult;
  touchIdle(): void;
}

export function handleHttp(host: HttpHost, req: IncomingMessage, res: ServerResponse): Promise<void> {
  return route(host, req, res).catch(() => {
    reply(res, 500, '');
  });
}

async function route(host: HttpHost, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET';
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!hostAllowed(req.headers.host, host.address, host.port)) {
    reply(res, 421, '');
    return;
  }
  const origin = header(req, 'origin');
  if (origin !== undefined && origin !== `http://${host.address}:${host.port}`) {
    reply(res, 403, '');
    return;
  }
  if (header(req, 'sec-fetch-site') === 'cross-site') {
    reply(res, 403, '');
    return;
  }
  const kind = classify(method, decodePath(url.pathname));
  const ip = clientAddress(req.socket.remoteAddress);
  // The page's own files come from a fixed in-memory map and carry no secret, so they don't count against the
  // unauthenticated limit: one load of the page fetches about twenty of them, and two reloads in a minute
  // would otherwise lock the phone out of its own fonts and scripts. The page itself, ping and pair still count.
  if (kind.kind === 'asset') {
    serveAsset(host, res, kind.name);
    return;
  }
  if (kind.kind === 'page' || kind.kind === 'ping' || kind.kind === 'pair' || kind.kind === 'ask') {
    const blocked = host.allowPublic(ip);
    if (blocked) {
      send(res, blocked);
      return;
    }
    await publicRoute(host, req, res, kind, ip);
    return;
  }
  // A phone waiting for a person's answer asks every second: those polls have their own limit (approvals.ts),
  // outside the 30-a-minute ceiling a minute of waiting would pass.
  if (kind.kind === 'wait' || kind.kind === 'cancel') {
    const body = await readJson(req);
    if (body === 'too-big' || body === 'bad') {
      reply(res, body === 'too-big' ? 413 : 400, body === 'too-big' ? 'too_large' : '');
      return;
    }
    send(res, kind.kind === 'wait' ? host.waitApproval(ip, body) : host.cancelApproval(ip, body));
    return;
  }
  if (kind.kind === 'missing' || kind.kind === 'tus-get') {
    reply(res, 404, '');
    return;
  }
  const credential = bearer(header(req, 'authorization'));
  const auth = await host.authorise(ip, credential, method);
  if (!auth.ok) {
    send(res, auth.result);
    return;
  }
  host.touchIdle();
  if (kind.kind === 'session') {
    send(res, host.session(auth.deviceId));
    return;
  }
  if (kind.kind === 'lookup') {
    const body = await readJson(req);
    if (body === 'too-big') {
      reply(res, 413, 'too_large');
      return;
    }
    if (body === 'bad') {
      reply(res, 400, '');
      return;
    }
    send(res, await host.lookup(auth.deviceId, body));
    return;
  }
  if (!host.tus) {
    reply(res, 404, '');
    return;
  }
  applySecurityHeaders(res);
  await requestDevice.run({ deviceId: auth.deviceId }, () => host.tus?.handle(req, res) ?? Promise.resolve());
}

async function publicRoute(
  host: HttpHost,
  req: IncomingMessage,
  res: ServerResponse,
  kind: Route,
  ip: string,
): Promise<void> {
  if (kind.kind === 'ping') {
    reply(res, 204, '');
    return;
  }
  if (kind.kind === 'page') {
    const page = host.assets['index.html'];
    if (!page) {
      reply(res, 404, '');
      return;
    }
    reply(res, 200, page.bytes, page.type);
    return;
  }
  const body = await readJson(req);
  if (body === 'too-big') {
    reply(res, 413, 'too_large');
    return;
  }
  if (body === 'bad') {
    reply(res, 400, '');
    return;
  }
  const userAgent = header(req, 'user-agent') ?? '';
  send(
    res,
    await (kind.kind === 'ask' ? host.askApproval(ip, userAgent, body) : host.pair(ip, userAgent, body)),
  );
}

function serveAsset(host: HttpHost, res: ServerResponse, name: string): void {
  const asset = host.assets[name];
  if (!asset) {
    reply(res, 404, '');
    return;
  }
  reply(res, 200, asset.bytes, asset.type);
}

function send(res: ServerResponse, result: HttpResult): void {
  const extra = result.retryAfter !== undefined ? { 'Retry-After': result.retryAfter } : undefined;
  reply(res, result.status, result.body ?? '', result.type, extra);
}

export function classify(method: string, pathname: string): Route {
  if (pathname === '/' && method === 'GET') return { kind: 'page' };
  if (pathname === '/api/ping' && method === 'GET') return { kind: 'ping' };
  if (pathname === '/api/pair' && method === 'POST') return { kind: 'pair' };
  if (pathname === '/api/pair/ask' && method === 'POST') return { kind: 'ask' };
  if (pathname === '/api/pair/wait' && method === 'POST') return { kind: 'wait' };
  if (pathname === '/api/pair/cancel' && method === 'POST') return { kind: 'cancel' };
  if (pathname === '/api/session' && method === 'GET') return { kind: 'session' };
  if (pathname === '/api/uploads/lookup' && method === 'POST') return { kind: 'lookup' };
  if (pathname === '/files' || pathname.startsWith('/files/')) {
    if (method === 'GET') return { kind: 'tus-get' };
    if (
      method === 'OPTIONS' ||
      method === 'POST' ||
      method === 'HEAD' ||
      method === 'PATCH' ||
      method === 'DELETE'
    ) {
      return { kind: 'tus' };
    }
  }
  if (method === 'GET' && pathname.startsWith('/assets/')) {
    const name = assetName(pathname.slice('/assets/'.length));
    if (name) return { kind: 'asset', name };
  }
  return { kind: 'missing' };
}

type Route =
  | {
      kind:
        | 'page'
        | 'ping'
        | 'pair'
        | 'ask'
        | 'wait'
        | 'cancel'
        | 'session'
        | 'lookup'
        | 'tus'
        | 'tus-get'
        | 'missing';
    }
  | { kind: 'asset'; name: string };

function assetName(raw: string): string | null {
  if (raw.length === 0 || raw.includes('/') || raw.includes('\\') || raw.includes('..')) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return null;
  }
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) return null;
  return decoded;
}

function decodePath(pathname: string): string {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return pathname;
  }
}

function hostAllowed(host: string | undefined, address: string, port: number): boolean {
  return host === `${address}:${port}`;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === 'string' ? value : undefined;
}

function bearer(value: string | undefined): string | null {
  if (!value) return null;
  const match = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(value);
  return match?.[1] ?? null;
}

function readJson(req: IncomingMessage): Promise<unknown | 'too-big' | 'bad'> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let settled = false;
    const finish = (value: unknown | 'too-big' | 'bad') => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      total += chunk.length;
      if (total > TRANSFER_LIMITS.maxJsonBytes) {
        finish('too-big');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (settled) return;
      const text = Buffer.concat(chunks).toString('utf8');
      if (text.length === 0) {
        finish('bad');
        return;
      }
      try {
        finish(JSON.parse(text) as unknown);
      } catch {
        finish('bad');
      }
    });
    req.on('error', () => finish('bad'));
  });
}
