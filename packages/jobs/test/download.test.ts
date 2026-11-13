// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The resumable downloader against a local HTTP server: resume with Range and
 * If-Range, restart when the remote file changed, retries, mirrors, timeouts,
 * cancellation and the checksum check.
 */
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadVerified, type DownloadOptions, type DownloadTarget } from '../src/components/download';
import { metaPathFor, readPartMeta } from '../src/components/resume-state';
import { DeterministicContent } from './helpers/content';
import { listFiles, noSleep, tempDir } from './helpers/fixtures';
import { TestServer } from './helpers/server';

const SIZE = 4 * 1024 * 1024 + 123;
const v1 = new DeterministicContent(SIZE, 'v1');
const v2 = new DeterministicContent(SIZE, 'v2');

let server: TestServer;
let dir: string;
let part: string;
let final: string;

beforeAll(async () => {
  server = await TestServer.start();
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  dir = await tempDir();
  part = join(dir, 'file.part');
  final = join(dir, 'file.download');
  server.requests.length = 0;
  server.serve('/file', { content: v1, etag: '"v1"', lastModified: 'Mon, 12 Oct 2026 10:00:00 GMT' });
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const target = (overrides: Partial<DownloadTarget> = {}): DownloadTarget => ({
  label: 'test-file',
  urls: [server.url('/file')],
  size: SIZE,
  sha256: v1.sha256(),
  ...overrides,
});

const options = (overrides: Partial<DownloadOptions> = {}): DownloadOptions => ({
  fetch: globalThis.fetch,
  sleep: noSleep,
  ...overrides,
});

/** Downloads until about `bytes` have arrived, then aborts, leaving a part file. */
async function interruptAfter(bytes: number, t = target()): Promise<number> {
  const controller = new AbortController();
  const result = await downloadVerified(t, part, final, {
    ...options(),
    signal: controller.signal,
    onBytes: (phase, done) => {
      if (phase === 'downloading' && done >= bytes) controller.abort();
    },
  });
  expect(result.ok).toBe(false);
  expect(!result.ok && result.error.code).toBe('core.cancelled');
  return (await stat(part)).size;
}

describe('downloadVerified', () => {
  it('downloads, verifies and renames a fresh file', async () => {
    const result = await downloadVerified(target(), part, final, options());
    expect(result).toEqual({ ok: true, value: { path: final, resumedFrom: 0, bytesFetched: SIZE } });
    expect(await listFiles(dir)).toEqual(['file.download']);
    expect(server.requests[0]!.range).toBeUndefined();
  });

  it('resumes a cancelled download from the bytes on disk, with If-Range', async () => {
    const offset = await interruptAfter(1024 * 1024);
    expect(offset).toBeGreaterThan(0);
    expect(await readPartMeta(part)).toMatchObject({ etag: '"v1"', size: SIZE, sha256: v1.sha256() });

    const phases = new Set<string>();
    const result = await downloadVerified(target(), part, final, options({ onBytes: (p) => phases.add(p) }));
    expect(result).toEqual({
      ok: true,
      value: { path: final, resumedFrom: offset, bytesFetched: SIZE - offset },
    });
    const resume = server.requests[1]!;
    expect(resume).toMatchObject({ range: `bytes=${offset}-`, ifRange: '"v1"', status: 206, start: offset });
    expect(resume.bytesSent).toBe(SIZE - offset);
    expect([...phases]).toEqual(['checking', 'downloading', 'verifying']);
  });

  it('retries a dropped connection and resumes where it broke', async () => {
    server.next('/file', { dropAfterBytes: 1_000_000 });
    const sleep = vi.fn(noSleep);
    const result = await downloadVerified(target(), part, final, options({ sleep }));
    expect(result.ok).toBe(true);
    const [first, second] = server.requests;
    expect(first!.bytesSent).toBe(1_000_000);
    expect(second!.range).toMatch(/^bytes=\d+-$/);
    expect(second!.start + second!.bytesSent).toBe(SIZE);
    expect(sleep).toHaveBeenCalledTimes(1);
  });

  it('restarts from zero when the ETag changed (compliant server answers If-Range with 200)', async () => {
    const offset = await interruptAfter(2 * 1024 * 1024);
    // Same version in the manifest, but the file at the URL was re-uploaded.
    server.serve('/file', { content: v1, etag: '"v1-reupload"' });
    const writes: number[] = [];
    const onBytes: DownloadOptions['onBytes'] = (phase, done) =>
      void (phase === 'downloading' && writes.push(done));
    const result = await downloadVerified(target(), part, final, options({ onBytes }));
    expect(result.ok && result.value.bytesFetched).toBe(SIZE);
    expect(server.requests[1]).toMatchObject({
      range: `bytes=${offset}-`,
      ifRange: '"v1"',
      status: 200,
      start: 0,
    });
    expect(server.requests[1]!.bytesSent).toBe(SIZE);
    // The part was rewritten from byte 0, not appended to.
    expect(writes[0]).toBeLessThan(offset);
    expect(await readPartMeta(part)).toBeUndefined();
  });

  it('never splices two versions: a changed file with the old checksum fails verification', async () => {
    await interruptAfter(2 * 1024 * 1024);
    server.serve('/file', { content: v2, etag: '"v2"' });
    const result = await downloadVerified(target(), part, final, options());
    expect(!result.ok && result.error.code).toBe('jobs.checksum_mismatch');
    expect(server.requests[1]!.status).toBe(200);
    expect(await listFiles(dir)).toEqual([]);
  });

  it('restarts from zero when a server ignores If-Range and resumes a changed file', async () => {
    await interruptAfter(2 * 1024 * 1024);
    server.serve('/file', { content: v1, etag: '"v1-reupload"' });
    server.next('/file', { ignoreIfRange: true });
    const result = await downloadVerified(target(), part, final, options());
    expect(result.ok).toBe(true);
    // The 206 for the old offset is refused; the next request has no Range.
    expect(server.requests[1]!.status).toBe(206);
    expect(server.requests[2]).toMatchObject({ range: undefined, status: 200 });
  });

  it('uses Last-Modified for If-Range when there is no strong ETag', async () => {
    server.serve('/file', { content: v1, etag: 'W/"weak"', lastModified: 'Mon, 12 Oct 2026 10:00:00 GMT' });
    const offset = await interruptAfter(1024 * 1024);
    expect((await downloadVerified(target(), part, final, options())).ok).toBe(true);
    expect(server.requests[1]).toMatchObject({
      range: `bytes=${offset}-`,
      ifRange: 'Mon, 12 Oct 2026 10:00:00 GMT',
    });
  });

  it('resumes without If-Range when the server sends no validators', async () => {
    server.serve('/file', { content: v1 });
    const offset = await interruptAfter(1024 * 1024);
    expect((await downloadVerified(target(), part, final, options())).ok).toBe(true);
    expect(server.requests[1]).toMatchObject({ range: `bytes=${offset}-`, ifRange: undefined, status: 206 });
  });

  it('starts over when the server does not support ranges', async () => {
    await interruptAfter(1024 * 1024);
    server.next('/file', { ignoreRange: true });
    const result = await downloadVerified(target(), part, final, options());
    expect(result.ok && result.value.bytesFetched).toBe(SIZE);
    expect(server.requests[1]!.status).toBe(200);
  });

  it('rejects a bad checksum and deletes the file', async () => {
    const result = await downloadVerified(target({ sha256: 'a'.repeat(64) }), part, final, options());
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({ code: 'jobs.checksum_mismatch', retryable: true });
    expect(await listFiles(dir)).toEqual([]);
  });

  it('falls through to the next mirror on a 404, and reports 404 when every mirror fails', async () => {
    const urls = [server.url('/missing'), server.url('/file')];
    expect((await downloadVerified(target({ urls }), part, final, options())).ok).toBe(true);
    await rm(final);
    const failed = await downloadVerified(target({ urls: [server.url('/nope')] }), part, final, options());
    expect(!failed.ok && failed.error).toMatchObject({
      code: 'jobs.download_rejected',
      params: { status: 404 },
    });
  });

  it('backs off on 503, honours Retry-After, and gives up after maxAttempts', async () => {
    server.next('/file', { status: 503 });
    server.next('/file', { status: 429, retryAfter: '7' });
    const sleep = vi.fn(noSleep);
    const retry = { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 10_000 };
    expect(
      (await downloadVerified(target(), part, final, options({ sleep, retry, random: () => 0.5 }))).ok,
    ).toBe(true);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([100, 7000]);

    await rm(final);
    for (let i = 0; i < 3; i++) server.next('/file', { status: 500 });
    const failed = await downloadVerified(target(), part, final, options({ retry }));
    expect(!failed.ok && failed.error).toMatchObject({ code: 'jobs.download_failed', retryable: true });
  });

  it('rejects a remote file whose size is not the manifest size', async () => {
    const result = await downloadVerified(target({ size: SIZE - 1 }), part, final, options());
    expect(!result.ok && result.error).toMatchObject({
      code: 'jobs.size_mismatch',
      params: { expectedBytes: SIZE - 1, actualBytes: SIZE },
    });
  });

  it('stops a body that runs past the expected size (no Content-Length)', async () => {
    server.next('/file', { omitLength: true });
    const result = await downloadVerified(target({ size: 1000 }), part, final, options());
    expect(!result.ok && result.error.code).toBe('jobs.size_mismatch');
    expect(await listFiles(dir)).toEqual([]);
  });

  it('times out waiting for headers, and when the body stalls, then resumes', async () => {
    server.next('/file', { headerDelayMs: 2_000 });
    const headers = await downloadVerified(
      target(),
      part,
      final,
      options({ headersTimeoutMs: 100, retry: { maxAttempts: 1, initialDelayMs: 0 } }),
    );
    expect(!headers.ok && headers.error.detail).toMatch(/no response within 100 ms/);

    server.next('/file', { holdAfterBytes: 500_000 });
    const result = await downloadVerified(target(), part, final, options({ stallTimeoutMs: 150 }));
    expect(result.ok).toBe(true);
    const last = server.requests.at(-1)!;
    expect(last.range).toBe('bytes=500000-');
  });

  it('is cancelled before any request when the signal is already aborted, and during a backoff', async () => {
    const aborted = AbortSignal.abort();
    const result = await downloadVerified(target(), part, final, options({ signal: aborted }));
    expect(!result.ok && result.error.code).toBe('core.cancelled');
    expect(server.requests).toHaveLength(0);

    server.next('/file', { status: 503 });
    const controller = new AbortController();
    const sleep = vi.fn(async () => {
      controller.abort();
      throw new Error('aborted');
    });
    const during = await downloadVerified(
      target(),
      part,
      final,
      options({ signal: controller.signal, sleep }),
    );
    expect(!during.ok && during.error.code).toBe('core.cancelled');
  });

  it('reuses a verified file from an earlier run, and replaces a corrupt one', async () => {
    expect((await downloadVerified(target(), part, final, options())).ok).toBe(true);
    const again = await downloadVerified(target(), part, final, options());
    expect(again.ok && again.value.bytesFetched).toBe(0);
    expect(server.requests).toHaveLength(1);

    await writeFile(final, Buffer.alloc(SIZE));
    const replaced = await downloadVerified(target(), part, final, options());
    expect(replaced.ok && replaced.value.bytesFetched).toBe(SIZE);
  });

  it('discards a part whose saved state is for another file, and verifies a complete part offline', async () => {
    await writeFile(part, Buffer.alloc(1000));
    await writeFile(
      metaPathFor(part),
      JSON.stringify({ v: 1, url: 'x', size: SIZE, sha256: 'b'.repeat(64) }),
    );
    expect((await downloadVerified(target(), part, final, options())).ok).toBe(true);
    expect(server.requests[0]!.range).toBeUndefined();

    // A whole part left by a crash just before the rename: no network needed.
    await rm(final);
    await writeFile(part, Buffer.concat([...v1.chunks()]));
    await writeFile(
      metaPathFor(part),
      JSON.stringify({ v: 1, url: server.url('/file'), size: SIZE, sha256: v1.sha256() }),
    );
    expect((await downloadVerified(target(), part, final, options())).ok).toBe(true);
    expect(server.requests).toHaveLength(1);
  });

  it('restarts after a 416 (the remote file shrank under our offset)', async () => {
    await interruptAfter(2 * 1024 * 1024);
    server.serve('/file', { content: new DeterministicContent(1024 * 1024, 'small'), etag: '"v1"' });
    const result = await downloadVerified(target(), part, final, options());
    expect(server.requests[1]).toMatchObject({ status: 416 });
    expect(server.requests[2]).toMatchObject({ range: undefined, status: 200 });
    expect(!result.ok && result.error.code).toBe('jobs.size_mismatch');
  });

  it('refuses a redirect to plain http and maps filesystem errors', async () => {
    const response = new Response('x');
    Object.defineProperty(response, 'url', { value: 'http://mirror.example/file' });
    const redirected = await downloadVerified(
      target(),
      part,
      final,
      options({ fetch: async () => response }),
    );
    expect(!redirected.ok && redirected.error).toMatchObject({
      code: 'jobs.download_rejected',
      params: { status: 200 },
    });

    // A missing folder is created; a file where the folder should be is a filesystem error.
    await writeFile(join(dir, 'not-a-folder'), 'x');
    const blocked = join(dir, 'not-a-folder', 'file.part');
    const fsFailure = await downloadVerified(target(), blocked, final, options());
    expect(!fsFailure.ok && fsFailure.error.code).toBe('jobs.install_failed');
  });

  it('reports a network error with the underlying cause as detail', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }),
      });
    });
    const result = await downloadVerified(
      target(),
      part,
      final,
      options({ fetch, retry: { maxAttempts: 2, initialDelayMs: 0 } }),
    );
    expect(!result.ok && result.error.detail).toMatch(/fetch failed.*ECONNREFUSED/);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('keeps the part across a cancel so nothing is downloaded twice', async () => {
    await mkdir(dir, { recursive: true });
    const offset = await interruptAfter(3 * 1024 * 1024);
    const resumed = await downloadVerified(target(), part, final, options());
    expect(resumed.ok && resumed.value.bytesFetched).toBe(SIZE - offset);
    expect(await readFile(final)).toHaveLength(SIZE);
  });
});
