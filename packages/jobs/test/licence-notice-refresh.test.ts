// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER round 4: a licence notice the manifest replaces while the component's version stays (sequence 16
 * corrected Deno's and llama.cpp's). The saved notice follows the manifest without the component being fetched or
 * touched again: at load, after an install that worked, and as a failed part's retry. Against the local test
 * server's faults: a notice held mid-transfer (the old one stays whole until the new one is renamed over it), a 404,
 * and a notice that doesn't match its pin.
 */
import { readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createComponentManager, type ComponentManifest, type InstalledComponent } from '@taalcut/jobs';
import { BufferContent, DeterministicContent, TEST_NOTICE } from './helpers/content';
import { manifestOf, noSleep, OpenedInTest, PLATFORM, plentyOfSpace, tempDir } from './helpers/fixtures';
import { TestServer } from './helpers/server';

const model = new DeterministicContent(256 * 1024, 'refresh-model');
const other = new DeterministicContent(64 * 1024, 'refresh-other');
/** The host's corrected notice: a new key (its sha256 in the name), the same component version. */
const corrected = new BufferContent(
  Buffer.from(
    'A test component\n\nMIT License\n\nPermission is hereby granted, …\n\nBoringSSL: ISC License, …\n',
  ),
);
const CORRECTED = '/model/NOTICE-corrected.txt';
const bytesOf = (content: BufferContent) => Buffer.concat([...content.chunks()]);

let server: TestServer;
let root: string;
const opened = new OpenedInTest();

beforeAll(async () => {
  server = await TestServer.start();
  server.serve('/model.bin', { content: model, etag: '"m1"' });
  server.serve('/other.bin', { content: other, etag: '"o1"' });
  server.serve(CORRECTED, { content: corrected, etag: '"n2"' });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  root = await tempDir('taalcut-notice-refresh-');
  server.requests.length = 0;
});
afterEach(async () => {
  await opened.closeAll();
  server.release();
  await rm(root, { recursive: true, force: true });
});

type Notice = { url: string; size: number; sha256: string };

/** `model` with the test server's notice beside it (as installed first), or another notice; `other` alongside. */
function manifest(notice?: Notice): ComponentManifest {
  return manifestOf(
    {
      id: 'model',
      urls: [server.url('/model.bin')],
      size: model.size,
      sha256: model.sha256(),
      ...(notice ? { notice } : {}),
    },
    { id: 'other', urls: [server.url('/other.bin')], size: other.size, sha256: other.sha256() },
  );
}

const correctedNotice = (): Notice => ({
  url: server.url(CORRECTED),
  size: corrected.size,
  sha256: corrected.sha256(),
});

const manager = (m: ComponentManifest) =>
  opened.add(
    createComponentManager({
      root,
      manifest: m,
      fetch: globalThis.fetch,
      statfs: plentyOfSpace,
      platform: PLATFORM,
      download: { sleep: noSleep, retry: { maxAttempts: 2, initialDelayMs: 0 } },
      progressIntervalMs: 0,
    }),
  );

/** `model` installed under the first manifest, by a manager that has closed again (the app before its update). */
async function installedFirst(): Promise<InstalledComponent> {
  const first = manager(manifest());
  const installed = await first.install('model');
  await first.close();
  if (!installed.ok) throw new Error(`install failed: ${installed.error.code}`);
  expect(await readFile(installed.value.notice)).toEqual(bytesOf(TEST_NOTICE));
  server.requests.length = 0;
  return installed.value;
}

async function registryEntry(id: string) {
  return JSON.parse(await readFile(join(root, 'registry.json'), 'utf8')).components[id];
}

describe('a licence notice the manifest replaces', () => {
  it('is fetched at load and renamed over the saved one, the component neither fetched nor touched', async () => {
    const installed = await installedFirst();
    const file = installed.file ?? '';
    const before = await stat(file);
    server.next(CORRECTED, { holdAfterBytes: 16 });

    const m = manager(manifest(correctedNotice()));
    const [row] = await m.list();
    // The load started it: the part is installed, its notice on its way.
    expect(row).toMatchObject({ id: 'model', state: 'notice_outdated', installing: true });
    expect(row?.installed?.notice).toBe(installed.notice);
    await server.waitForHold(CORRECTED);
    // Mid-transfer, the saved notice is still the whole old one: never a folder without one, or with half of one.
    expect(await readFile(installed.notice)).toEqual(bytesOf(TEST_NOTICE));
    server.release(CORRECTED);
    await m.refreshNotices();

    expect(await readFile(installed.notice)).toEqual(bytesOf(corrected));
    expect(server.requestsFor(CORRECTED)).toMatchObject([
      { acceptEncoding: 'identity', status: 200, bytesSent: corrected.size },
    ]);
    // Its file wasn't fetched again, or replaced.
    expect(server.requestsFor('/model.bin')).toEqual([]);
    const after = await stat(file);
    expect([after.ino, after.mtimeMs, after.size]).toEqual([before.ino, before.mtimeMs, before.size]);
    // The registry records the notice now saved, and the installed size follows it.
    const entry = await registryEntry('model');
    expect(entry.licence.notice).toEqual(correctedNotice());
    expect(entry.bytes).toBe(model.size + corrected.size);
    expect((await m.list())[0]).toMatchObject({ state: 'installed', installing: false });
    expect((await m.list())[0]?.lastError).toBeUndefined();
    expect((await m.get('model'))?.notice).toBe(installed.notice);
  });

  it('that doesn’t arrive keeps the old one and is the part’s last error; a retry fetches only the notice', async () => {
    const installed = await installedFirst();
    server.next(CORRECTED, { status: 404 });
    const m = manager(manifest(correctedNotice()));
    await m.refreshNotices();

    const [row] = await m.list();
    expect(row).toMatchObject({
      state: 'notice_outdated',
      installing: false,
      lastError: { code: 'jobs.download_rejected', params: { component: 'model', status: 404 } },
    });
    expect(row?.installed?.notice).toBe(installed.notice);
    expect(await readFile(installed.notice)).toEqual(bytesOf(TEST_NOTICE));
    expect((await registryEntry('model')).licence.notice.sha256).toBe(TEST_NOTICE.sha256());

    // A failed part's Retry installs it: all that is left to fetch is the notice.
    const plan = await m.plan(['model']);
    expect(plan.ok && plan.value.components).toEqual([
      { id: 'model', version: '1.0.0', downloadBytes: corrected.size, extractBytes: 0 },
    ]);
    const retried = await m.install('model');
    expect(retried.ok && retried.value.notice).toBe(installed.notice);
    expect(await readFile(installed.notice)).toEqual(bytesOf(corrected));
    expect(server.requestsFor('/model.bin')).toEqual([]);
    expect((await m.list())[0]).toMatchObject({ state: 'installed' });
    expect((await m.list())[0]?.lastError).toBeUndefined();
  });

  it('that doesn’t match its pin is refused the same way, the old one kept', async () => {
    const installed = await installedFirst();
    const m = manager(manifest({ ...correctedNotice(), sha256: 'e'.repeat(64) }));
    await m.refreshNotices();
    const [row] = await m.list();
    expect(row).toMatchObject({ state: 'notice_outdated', lastError: { code: 'jobs.checksum_mismatch' } });
    expect(row?.lastError?.detail).toContain('licence notice');
    expect(await readFile(installed.notice)).toEqual(bytesOf(TEST_NOTICE));
    expect(server.requestsFor('/model.bin')).toEqual([]);
  });

  it('gets another go after an install that works', async () => {
    const installed = await installedFirst();
    server.next(CORRECTED, { status: 404 });
    const m = manager(manifest(correctedNotice()));
    await m.refreshNotices();
    expect((await m.list())[0]?.lastError?.code).toBe('jobs.download_rejected');

    // The network answers again: installing something else picks the notice up too.
    expect((await m.install('other')).ok).toBe(true);
    await m.refreshNotices();
    expect(await readFile(installed.notice)).toEqual(bytesOf(corrected));
    expect((await m.list())[0]).toMatchObject({ state: 'installed' });
    expect(server.requestsFor('/model.bin')).toEqual([]);
  });

  it('is brought up to date by updateAll too', async () => {
    const installed = await installedFirst();
    server.next(CORRECTED, { status: 404 });
    const m = manager(manifest(correctedNotice()));
    await m.refreshNotices();
    const updated = await m.updateAll();
    expect(updated.ok && updated.value).toEqual(['model']);
    expect(await readFile(installed.notice)).toEqual(bytesOf(corrected));
  });
});
