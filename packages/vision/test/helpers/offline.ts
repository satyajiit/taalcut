// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Makes every way out of this process throw and records the attempt: fetch,
 * net and tls connections, http(s) requests and DNS lookups. Child processes
 * (FFmpeg) are local and stay allowed.
 */
import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import tls from 'node:tls';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export interface NetworkGuard {
  readonly attempts: string[];
  restore(): void;
}

export function blockNetwork(): NetworkGuard {
  const attempts: string[] = [];
  const refuse = (what: string) => () => {
    attempts.push(what);
    throw new Error(`network disabled in this test: ${what}`);
  };
  const saved = {
    fetch: globalThis.fetch,
    connect: net.Socket.prototype.connect,
    netConnect: net.connect,
    createConnection: net.createConnection,
    tlsConnect: tls.connect,
    httpRequest: http.request,
    httpGet: http.get,
    httpsRequest: https.request,
    httpsGet: https.get,
    lookup: dns.lookup,
  };
  globalThis.fetch = refuse('fetch') as unknown as typeof fetch;
  net.Socket.prototype.connect = refuse('net.Socket.connect') as never;
  (net as { connect: unknown }).connect = refuse('net.connect');
  (net as { createConnection: unknown }).createConnection = refuse('net.createConnection');
  (tls as { connect: unknown }).connect = refuse('tls.connect');
  (http as { request: unknown }).request = refuse('http.request');
  (http as { get: unknown }).get = refuse('http.get');
  (https as { request: unknown }).request = refuse('https.request');
  (https as { get: unknown }).get = refuse('https.get');
  (dns as { lookup: unknown }).lookup = refuse('dns.lookup');
  return {
    attempts,
    restore() {
      globalThis.fetch = saved.fetch;
      net.Socket.prototype.connect = saved.connect;
      (net as { connect: unknown }).connect = saved.netConnect;
      (net as { createConnection: unknown }).createConnection = saved.createConnection;
      (tls as { connect: unknown }).connect = saved.tlsConnect;
      (http as { request: unknown }).request = saved.httpRequest;
      (http as { get: unknown }).get = saved.httpGet;
      (https as { request: unknown }).request = saved.httpsRequest;
      (https as { get: unknown }).get = saved.httpsGet;
      (dns as { lookup: unknown }).lookup = saved.lookup;
    },
  };
}

/**
 * A component folder for live model tests: `TAALCUT_<ID>_DIR`, else the
 * gitignored `packages/vision/.cache/<id>` filled once by hand (SPEC.md,
 * "Live model runs"). Undefined when neither has `marker`.
 */
export function componentDir(id: string, marker: string): string | undefined {
  const env = process.env[`TAALCUT_${id.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_DIR`];
  const dir = env ?? fileURLToPath(new URL(`../../.cache/${id}/`, import.meta.url));
  return existsSync(`${dir}/${marker}`) ? dir : undefined;
}
