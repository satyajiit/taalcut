// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Redirects are followed by hand, so where one leads is checked before
 * anything connects there: https only (loopback too), no credentials, no
 * link-local address, a few hops at most. Review 2 found a mirror's 302 to
 * http://127.0.0.1 followed and the body saved.
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { downloadVerified } from '../src/components/download';
import type { FetchInit, FetchLike } from '../src/components/http';
import { isAllowedDownloadUrl } from '../src/components/manifest';
import { BufferContent } from './helpers/content';
import { noSleep, tempDir } from './helpers/fixtures';
import { TestServer } from './helpers/server';

const body = Buffer.from('component bytes');
const content = new BufferContent(body);

let server: TestServer;
let dir: string;
let part: string;
let final: string;

beforeAll(async () => {
  server = await TestServer.start();
  server.serve('/file', { content });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  dir = await tempDir();
  part = join(dir, 'file.part');
  final = join(dir, 'file.download');
  server.requests.length = 0;
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function run(urls: string[], fetch: FetchLike) {
  const target = { label: 'test-file', urls, size: body.length, sha256: content.sha256() };
  return downloadVerified(target, part, final, {
    fetch,
    sleep: noSleep,
    retry: { maxAttempts: 1, initialDelayMs: 0 },
  });
}

/** A fetch that answers from a table of URLs and records what it was asked for. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: { url: string; init: FetchInit }[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url];
    if (!route) throw new TypeError(`fetch failed: nothing at ${url}`);
    return route();
  };
  return { fetch, calls };
}

const redirect =
  (location: string | null, status = 302) =>
  () =>
    new Response(null, { status, headers: location === null ? {} : { location } });

/** A 200 whose `url` says where it came from, as undici sets it. */
const served = (url: string) => () => {
  const response = new Response(body, { headers: { 'content-length': String(body.length) } });
  Object.defineProperty(response, 'url', { value: url });
  return response;
};

const rejected = { ok: false, error: { code: 'jobs.download_rejected' } };

describe('redirects', () => {
  it('does not follow a mirror to plain http, even on this machine', async () => {
    server.next('/file', { redirectTo: server.url('/file') });
    expect(await run([server.url('/file')], globalThis.fetch)).toMatchObject(rejected);
    expect(server.requestsFor('/file')).toHaveLength(1);
  });

  it('follows https redirects by hand, with the same request headers at each hop', async () => {
    const { fetch, calls } = fakeFetch({
      'https://a.example/dir/f': redirect('https://b.example/f', 301),
      'https://b.example/f': redirect('../other/f', 307),
      'https://b.example/other/f': served('https://b.example/other/f'),
    });
    const result = await run(['https://a.example/dir/f'], fetch);
    expect(result.ok).toBe(true);
    expect(await readFile(final)).toEqual(body);
    expect(calls.map((c) => c.url)).toEqual([
      'https://a.example/dir/f',
      'https://b.example/f',
      'https://b.example/other/f',
    ]);
    expect(calls.every((c) => c.init.redirect === 'manual')).toBe(true);
    expect(new Set(calls.map((c) => JSON.stringify(c.init.headers))).size).toBe(1);
  });

  it.each([
    ['plain http on loopback', 'http://127.0.0.1:9/secret'],
    ['a file URL', 'file:///etc/passwd'],
    ['a link-local address', 'https://169.254.169.254/latest/meta-data'],
    ['a link-local address written as IPv4-mapped IPv6', 'https://[::ffff:169.254.169.254]/x'],
    ['an IPv6 link-local address', 'https://[fe80::1]/x'],
    ['credentials', 'https://user:pw@mirror.example/x'],
    ['another scheme', 'ftp://mirror.example/x'],
  ])('refuses a redirect to %s before connecting', async (_, location) => {
    const { fetch, calls } = fakeFetch({ 'https://mirror.example/f': redirect(location) });
    expect(await run(['https://mirror.example/f'], fetch)).toMatchObject(rejected);
    expect(calls).toHaveLength(1);
  });

  it('moves on to the next mirror after a redirect loop or a redirect without a Location', async () => {
    const loop: Record<string, () => Response> = {};
    for (let i = 0; i < 10; i++) loop[`https://loop.example/${i}`] = redirect(`/${i + 1}`);
    const { fetch, calls } = fakeFetch({
      ...loop,
      'https://nowhere.example/f': redirect(null),
      'https://good.example/f': served('https://good.example/f'),
    });
    const result = await run(
      ['https://loop.example/0', 'https://nowhere.example/f', 'https://good.example/f'],
      fetch,
    );
    expect(result.ok).toBe(true);
    expect(calls.filter((c) => c.url.startsWith('https://loop.example/'))).toHaveLength(6);
  });

  it('checks where a fetch that follows redirects itself ended up, and refuses one that does not say', async () => {
    const elsewhere = fakeFetch({ 'https://mirror.example/f': served('http://127.0.0.1:9/elsewhere') });
    expect(await run(['https://mirror.example/f'], elsewhere.fetch)).toMatchObject(rejected);
    const cdn = fakeFetch({ 'https://mirror.example/f': served('https://cdn.example/f') });
    expect((await run(['https://mirror.example/f'], cdn.fetch)).ok).toBe(true);
    await rm(final);
    const unsigned = fakeFetch({ 'https://mirror.example/f': () => new Response(body) });
    expect(await run(['https://mirror.example/f'], unsigned.fetch)).toMatchObject(rejected);
  });

  it('keeps link-local addresses out of the manifest too', () => {
    expect(isAllowedDownloadUrl('https://169.254.169.254/x')).toBe(false);
    expect(isAllowedDownloadUrl('https://[fe80::1]/x')).toBe(false);
    expect(isAllowedDownloadUrl('https://[::ffff:a9fe:a9fe]/x')).toBe(false);
    expect(isAllowedDownloadUrl('https://169.255.0.1/x')).toBe(true);
  });
});
