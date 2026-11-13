// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createServer, type RequestListener, type Server } from 'node:http';
import type * as dns from 'node:dns/promises';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createContainer, GeneratedAssetSinkToken, newId, ok, type GeneratedFile } from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureCreationUrl } from '../src/utility/creation/browser';
import { fetchCreationResource, isPublicCreationAddress } from '../src/utility/creation/network';
import type { UtilityConfig } from '../src/shared/rpc-ipc';
import { hasTestHeadlessShell } from './helpers/test-headless-shell';

/** The captures run the pinned headless browser; a checkout that has not fetched it skips them. */
const shell = hasTestHeadlessShell('creation browser capture');

const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', async (original) => {
  const actual = await original<typeof dns>();
  lookup.mockImplementation(actual.lookup);
  return { ...actual, lookup };
});

const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  lookup.mockClear();
});

async function serve(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP address');
  return `http://127.0.0.1:${address.port}`;
}

async function world() {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-capture-test-'));
  roots.push(root);
  const files: GeneratedFile[] = [];
  const container = createContainer().value(GeneratedAssetSinkToken, {
    async put(file) {
      files.push(file);
      return ok({ assetId: newId<'Asset'>(), contentHash: 'capture', duplicate: false });
    },
  });
  const config: UtilityConfig = {
    process: 'agent',
    dbPath: ':memory:',
    userData: root,
    resourcesPath: root,
    packaged: false,
    componentManifest: '',
  };
  return { files, container, config };
}

const signal = () => new AbortController().signal;
const pixel = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=',
  'base64',
);

describe('creation browser capture', () => {
  it('captures rendered brand text, redirected CSS, a real font and a delayed image in an isolated browser', async ({
    skip,
  }) => {
    skip(!shell);
    const f = await world();
    const font = await readFile(
      join(
        import.meta.dirname,
        '../../renderer/node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2',
      ),
    );
    const hits: string[] = [];
    let imageFinished = false;
    const origin = await serve((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      if (req.url === '/redirect.css') {
        res.writeHead(302, { location: '/brand/styles/site.css' }).end();
      } else if (req.url === '/brand/styles/site.css') {
        res.writeHead(200, { 'content-type': 'text/css' }).end(`
          @font-face{font-family:'Onest Variable';src:url('../fonts/onest.woff2')}
          h1{font-family:'Onest Variable';color:rgb(22,170,88)}
          body{background:#fff}img{width:100px;height:100px}
        `);
      } else if (req.url === '/brand/fonts/onest.woff2') {
        res.writeHead(200, { 'content-type': 'font/woff2' }).end(font);
      } else if (req.url === '/hero.png') {
        setTimeout(() => {
          imageFinished = true;
          res.writeHead(200, { 'content-type': 'image/png' }).end(pixel);
        }, 1800);
      } else {
        res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html>
          <title>OpenAlly launch</title><link rel="stylesheet" href="/redirect.css">
          <h1>Initial title</h1><p>Bring the complete team together in a shared workspace.</p>
          <img src="/hero.png"><button id="launch">Start creating</button>
          <script>
            document.querySelector('h1').textContent = 'OpenAlly rendered product';
            fetch('/unsafe', {method:'POST',body:'must never leave browser'}).catch(() => {});
            try { new Worker('/worker.js'); } catch {}
          </script>`);
      }
    });
    const result = await captureCreationUrl(f.container, f.config, origin, signal(), { localOrigin: origin });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    if (!result.ok) return;
    expect(result.value.title).toBe('OpenAlly launch');
    expect(result.value.text).toContain('OpenAlly rendered product');
    expect(result.value.text).toContain('rgb(22, 170, 88)');
    expect(result.value.text).toContain('Onest Variable');
    expect(hits).toContain('GET /brand/fonts/onest.woff2');
    expect(hits.some((hit) => hit.includes('/unsafe') || hit.includes('/worker.js'))).toBe(false);
    expect(imageFinished).toBe(true);
    expect(f.files).toHaveLength(1);
    const png = Buffer.from(f.files[0]!.bytes);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1920, 1080]);
    expect(f.files[0]!.provenance).toMatchObject({ generation: 'workspace', access: 'local' });
  }, 30_000);

  it('denies public captures of loopback URLs before launching a browser or contacting the server', async () => {
    const f = await world();
    let hits = 0;
    const origin = await serve((_req, res) => {
      hits++;
      res.end('Private product');
    });
    const result = await captureCreationUrl(f.container, f.config, origin, signal());
    expect(result).toMatchObject({ ok: false, error: { code: 'core.validation' } });
    expect(hits).toBe(0);
    expect(f.files).toEqual([]);
  });

  it('cancels an in-progress browser capture without keeping an incomplete image', async ({ skip }) => {
    skip(!shell);
    const f = await world();
    const controller = new AbortController();
    let visits = 0;
    const origin = await serve((_req, res) => {
      visits++;
      if (visits === 1)
        res.writeHead(200, { 'content-type': 'text/html' }).end('<h1>Product preview is starting</h1>');
      else controller.abort();
    });
    const result = await captureCreationUrl(f.container, f.config, origin, controller.signal, {
      localOrigin: origin,
    });
    expect(result).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(visits).toBe(2);
    expect(f.files).toEqual([]);
  }, 30_000);

  it('limits parallel page resource downloads to eight', async ({ skip }) => {
    skip(!shell);
    const f = await world();
    let active = 0;
    let peak = 0;
    let finished = 0;
    const origin = await serve((req, res) => {
      if (req.url?.startsWith('/image-')) {
        active++;
        peak = Math.max(peak, active);
        setTimeout(() => {
          active--;
          finished++;
          res.writeHead(200, { 'content-type': 'image/png' }).end(pixel);
        }, 100);
      } else {
        const images = Array.from(
          { length: 24 },
          (_, index) => `<img width="10" height="10" src="/image-${index}.png">`,
        ).join('');
        res
          .writeHead(200, { 'content-type': 'text/html' })
          .end(`<h1>All product images load with bounded downloads</h1>${images}`);
      }
    });
    const result = await captureCreationUrl(f.container, f.config, origin, signal(), { localOrigin: origin });
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(peak).toBeLessThanOrEqual(8);
    expect(finished).toBe(24);
  }, 30_000);
});

describe('creation network boundary', () => {
  it('rejects private, mapped and transition addresses while allowing global unicast', () => {
    for (const address of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '192.168.0.1',
      '169.254.169.254',
      '100.64.0.1',
      '::1',
      '::ffff:127.0.0.1',
      'fc00::1',
      '2002:7f00:1::',
      '2001:db8::1',
      '2001::1',
      '2001:0000:0000:0000:0000:0000:0000:0001',
    ]) {
      expect(isPublicCreationAddress(address), address).toBe(false);
    }
    expect(isPublicCreationAddress('8.8.8.8')).toBe(true);
    expect(isPublicCreationAddress('2606:4700:4700::1111')).toBe(true);
  });

  it('pins the validated DNS answer and revalidates redirects against a changed answer', async () => {
    let hits = 0;
    const origin = await serve((req, res) => {
      hits++;
      if (req.url === '/redirect') res.writeHead(302, { location: '/private' }).end();
      else res.end('public response');
    });
    const url = origin.replace('127.0.0.1', 'product.example');
    lookup.mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const pinned = await fetchCreationResource(url, { signal: signal(), maxBytes: 1024, localOrigin: url });
    expect(pinned.ok, JSON.stringify(pinned)).toBe(true);
    expect(lookup).toHaveBeenCalledTimes(1);
    lookup
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }])
      .mockResolvedValueOnce([{ address: '10.0.0.1', family: 4 }]);
    const redirected = await fetchCreationResource(`${url}/redirect`, {
      signal: signal(),
      maxBytes: 1024,
      localOrigin: url,
    });
    expect(redirected).toMatchObject({ ok: false, error: { code: 'core.validation' } });
    expect(hits).toBe(2);
  });

  it('keeps local authorization scoped to its origin and caps bytes and redirect chains', async () => {
    let escaped = 0;
    const elsewhere = await serve((_req, res) => {
      escaped++;
      res.end('private');
    });
    const origin = await serve((req, res) => {
      if (req.url === '/escape') res.writeHead(302, { location: elsewhere }).end();
      else if (req.url === '/loop') res.writeHead(302, { location: '/loop' }).end();
      else res.end('x'.repeat(1025));
    });
    const options = { signal: signal(), maxBytes: 1024, localOrigin: origin };
    expect(await fetchCreationResource(`${origin}/escape`, options)).toMatchObject({
      ok: false,
      error: { code: 'core.validation' },
    });
    expect(escaped).toBe(0);
    expect(await fetchCreationResource(`${origin}/loop`, options)).toMatchObject({
      ok: false,
      error: { code: 'core.validation' },
    });
    expect((await fetchCreationResource(origin, options)).ok).toBe(false);
    expect(await fetchCreationResource('file:///etc/hosts', options)).toMatchObject({ ok: false });
    expect(await fetchCreationResource(origin.replace('://', '://user:secret@'), options)).toMatchObject({
      ok: false,
    });
  });
});
