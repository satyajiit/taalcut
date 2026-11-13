// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER round 3: each component's licence notice (the NOTICE.txt hosted beside it, pinned by
 * `licence.notice`) is fetched like an artifact, verified, and saved in the component's folder at install, against
 * the local test server's faults. A notice that doesn't match is a failed download of the component, before its
 * file is fetched; a dropped notice resumes; a missing one is a hard failure with its reason.
 */
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createComponentManager, type ComponentManifest } from '@taalcut/jobs';
import { BufferContent, DeterministicContent, noticeUrlFor, TEST_NOTICE } from './helpers/content';
import {
  listFiles,
  manifestOf,
  noSleep,
  OpenedInTest,
  PLATFORM,
  plentyOfSpace,
  tempDir,
} from './helpers/fixtures';
import { TestServer } from './helpers/server';

const model = new DeterministicContent(256 * 1024, 'notice-model');
/** A notice as long as the longest hosted (c2pa-sidecar's, 2 MB), so a dropped connection leaves part of it. */
const longNotice = new BufferContent(Buffer.alloc(2 * 1024 * 1024, 'Licence text. '));

let server: TestServer;
let root: string;
const opened = new OpenedInTest();

beforeAll(async () => {
  server = await TestServer.start();
  server.serve('/model.bin', { content: model, etag: '"m1"' });
  server.serve('/long/NOTICE.txt', { content: longNotice, etag: '"n1"' });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  root = await tempDir('taalcut-notice-');
  server.requests.length = 0;
});
afterEach(async () => {
  await opened.closeAll();
  server.release();
  await rm(root, { recursive: true, force: true });
});

function manifest(notice?: { url: string; size: number; sha256: string }): ComponentManifest {
  return manifestOf({
    id: 'model',
    urls: [server.url('/model.bin')],
    size: model.size,
    sha256: model.sha256(),
    ...(notice ? { notice } : {}),
  });
}

const manager = (m: ComponentManifest) =>
  opened.add(
    createComponentManager({
      root,
      manifest: m,
      fetch: globalThis.fetch,
      statfs: plentyOfSpace,
      platform: PLATFORM,
      download: { sleep: noSleep, retry: { maxAttempts: 3, initialDelayMs: 0 } },
      progressIntervalMs: 0,
    }),
  );

describe('the licence notice', () => {
  it('is fetched uncompressed, verified and saved in the component’s folder, and the registry records it', async () => {
    const m = manager(manifest());
    const installed = await m.install('model');
    expect(installed.ok).toBe(true);
    if (!installed.ok) return;
    expect(installed.value.notice).toBe(join(installed.value.path, 'TAALCUT-NOTICE.txt'));
    expect(await readFile(installed.value.notice)).toEqual(Buffer.concat([...TEST_NOTICE.chunks()]));
    const notice = server.requestsFor(noticeUrlFor('/model.bin'));
    expect(notice).toMatchObject([{ acceptEncoding: 'identity', status: 200, bytesSent: TEST_NOTICE.size }]);
    const registry = JSON.parse(await readFile(join(root, 'registry.json'), 'utf8'));
    expect(registry.components.model.notice).toBe('TAALCUT-NOTICE.txt');
    // A manager started later reads it back from the registry.
    expect((await manager(manifest()).get('model'))?.notice).toBe(installed.value.notice);
  });

  it('that doesn’t match its sha256 fails the download before the file is fetched, and says so', async () => {
    const wrong = {
      url: server.url(noticeUrlFor('/model.bin')),
      size: TEST_NOTICE.size,
      sha256: 'e'.repeat(64),
    };
    const m = manager(manifest(wrong));
    const result = await m.install('model');
    expect(!result.ok && result.error).toMatchObject({
      code: 'jobs.checksum_mismatch',
      params: { component: 'model' },
    });
    expect(!result.ok && result.error.detail).toContain('licence notice');
    expect(server.requestsFor('/model.bin')).toEqual([]);
    expect(await m.get('model')).toBeUndefined();
    // Nothing of it is kept, and the row says why after a restart too.
    expect(await listFiles(join(root, 'downloads'))).toEqual([]);
    const row = (await manager(manifest(wrong)).list()).find((status) => status.id === 'model');
    expect(row).toMatchObject({ state: 'not_installed', lastError: { code: 'jobs.checksum_mismatch' } });
  });

  it('of another size fails the download as a size mismatch', async () => {
    const short = {
      url: server.url(noticeUrlFor('/model.bin')),
      size: TEST_NOTICE.size + 10,
      sha256: TEST_NOTICE.sha256(),
    };
    const result = await manager(manifest(short)).install('model');
    expect(!result.ok && result.error.code).toBe('jobs.size_mismatch');
    expect(server.requestsFor('/model.bin')).toEqual([]);
  });

  it('that drops mid-transfer resumes from the bytes it has', async () => {
    const long = { url: server.url('/long/NOTICE.txt'), size: longNotice.size, sha256: longNotice.sha256() };
    server.next('/long/NOTICE.txt', { dropAfterBytes: 1536 * 1024 });
    const installed = await manager(manifest(long)).install('model');
    expect(installed.ok).toBe(true);
    const [first, resumed] = server.requestsFor('/long/NOTICE.txt');
    expect(first).toMatchObject({ range: undefined, status: 200, bytesSent: 1536 * 1024 });
    expect(resumed).toMatchObject({ ifRange: '"n1"', status: 206 });
    expect(resumed?.start).toBeGreaterThan(0);
    expect(resumed?.range).toBe(`bytes=${resumed?.start}-`);
    expect((resumed?.start ?? 0) + (resumed?.bytesSent ?? 0)).toBe(longNotice.size);
    const saved = installed.ok ? await readFile(installed.value.notice) : Buffer.alloc(0);
    expect(saved.equals(Buffer.concat([...longNotice.chunks()]))).toBe(true);
  });

  it('that is missing on the host is a failed download with its reason, not a retry loop', async () => {
    const gone = { url: server.url('/gone/NOTICE.txt'), size: 10, sha256: 'a'.repeat(64) };
    const result = await manager(manifest(gone)).install('model');
    expect(!result.ok && result.error).toMatchObject({
      code: 'jobs.download_rejected',
      params: { component: 'model', status: 404 },
    });
    expect(server.requestsFor('/gone/NOTICE.txt')).toHaveLength(1);
    expect(server.requestsFor('/model.bin')).toEqual([]);
  });
});
