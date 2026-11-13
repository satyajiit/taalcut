// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REGISTRY = 'https://registry.npmjs.org';
const PACKAGE = /^(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i;
const MAX_BYTES = 64 * 1024 * 1024;

function dependencyNames(value: unknown, names: Set<string>): void {
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (
      ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].includes(key) &&
      item &&
      typeof item === 'object'
    )
      for (const name of Object.keys(item)) if (PACKAGE.test(name)) names.add(name);
    if (item && typeof item === 'object') dependencyNames(item, names);
  }
}

function tarballPaths(value: unknown, paths: Set<string>): void {
  if (typeof value === 'string' && value.startsWith(`${REGISTRY}/`)) {
    const url = new URL(value);
    if (!url.search && !url.hash && url.pathname.endsWith('.tgz')) paths.add(url.pathname);
  } else if (value && typeof value === 'object') {
    for (const item of Object.values(value)) tarballPaths(item, paths);
  }
}

/** Only known package metadata and integrity-pinned tarballs cross this bridge; scripts receive no internet. */
export async function creationRegistry(work: string, port: number, signal: AbortSignal) {
  const base = `http://127.0.0.1:${port}`;
  const names = new Set<string>();
  const tarballs = new Set<string>();
  for (const name of ['package.json', 'package-lock.json']) {
    const text = await readFile(join(work, name), 'utf8').catch(() => null);
    if (!text) continue;
    const json: unknown = JSON.parse(text);
    dependencyNames(json, names);
    tarballPaths(json, tarballs);
    if (name === 'package-lock.json') await writeFile(join(work, name), text.replaceAll(REGISTRY, base));
  }
  const pnpm = await readFile(join(work, 'pnpm-lock.yaml'), 'utf8').catch(() => null);
  if (pnpm) {
    for (const match of pnpm.matchAll(
      /^ {2}['"]?((?:@[^/\s]+\/)?[^\s'":]+)@([^\s'":(]+)(?:\([^\n]+)?['"]?:\s*$/gm,
    )) {
      const name = match[1]!;
      const version = match[2]!;
      if (!PACKAGE.test(name) || !/^[\w.+-]+$/.test(version)) continue;
      names.add(name);
      tarballs.add(`/${name}/-/${name.split('/').at(-1)}-${version}.tgz`);
    }
    await writeFile(join(work, 'pnpm-lock.yaml'), pnpm.replaceAll(REGISTRY, base));
  }
  let closed = false;
  const controller = new AbortController();
  const abort = AbortSignal.any([signal, controller.signal]);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', base);
      const path = decodeURIComponent(url.pathname).slice(1);
      if (
        closed ||
        request.method !== 'GET' ||
        url.search ||
        url.origin !== base ||
        (!names.has(path) && !tarballs.has(decodeURIComponent(url.pathname)))
      ) {
        response.writeHead(403).end('Registry request is not a declared dependency');
        return;
      }
      const upstream = await fetch(`${REGISTRY}${url.pathname}`, {
        signal: abort,
        redirect: 'error',
        headers: { accept: 'application/vnd.npm.install-v1+json' },
      });
      if (!upstream.ok || !upstream.body) {
        response.writeHead(upstream.status).end();
        return;
      }
      const reader = upstream.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > MAX_BYTES) {
          await reader.cancel();
          throw new Error('Dependency exceeds the download limit');
        }
        chunks.push(part.value);
      }
      let body = Buffer.concat(chunks);
      const type = upstream.headers.get('content-type') ?? 'application/octet-stream';
      if (type.includes('json')) {
        const json: unknown = JSON.parse(body.toString('utf8'));
        dependencyNames(json, names);
        tarballPaths(json, tarballs);
        body = Buffer.from(JSON.stringify(json).replaceAll(REGISTRY, base));
      }
      response.writeHead(200, { 'content-type': type, 'content-length': body.length }).end(body);
    } catch {
      if (!response.headersSent) response.writeHead(502);
      response.end('Dependency fetch failed');
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  return {
    base,
    async close() {
      closed = true;
      controller.abort();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
