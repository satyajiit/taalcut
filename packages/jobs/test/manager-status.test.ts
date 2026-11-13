// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What list() says while an install runs (its latest progress) and after one fails (why), so Settings and first
 * run can show a bar and a plain error instead of a row that silently goes back to "not installed" (UX2-MODELS).
 */
import { rm } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createComponentManager, type ComponentManifest } from '@taalcut/jobs';
import { DeterministicContent } from './helpers/content';
import { manifestOf, noSleep, OpenedInTest, PLATFORM, plentyOfSpace, tempDir } from './helpers/fixtures';
import { TestServer } from './helpers/server';

const MiB = 1024 * 1024;
const runtime = new DeterministicContent(1 * MiB, 'status-runtime');
const model = new DeterministicContent(2 * MiB, 'status-model');

let server: TestServer;
let root: string;
const opened = new OpenedInTest();

beforeAll(async () => {
  server = await TestServer.start();
  server.serve('/runtime', { content: runtime });
  server.serve('/model', { content: model });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  root = await tempDir();
});
afterEach(async () => {
  await opened.closeAll();
  await rm(root, { recursive: true, force: true });
});

function manifest(): ComponentManifest {
  return manifestOf(
    { id: 'runtime', urls: [server.url('/runtime')], size: runtime.size, sha256: runtime.sha256() },
    {
      id: 'model',
      urls: [server.url('/model')],
      size: model.size,
      sha256: model.sha256(),
      dependencies: ['runtime'],
    },
  );
}

const manager = () =>
  opened.add(
    createComponentManager({
      root,
      manifest: manifest(),
      fetch: globalThis.fetch,
      statfs: plentyOfSpace,
      platform: PLATFORM,
      download: { sleep: noSleep, retry: { maxAttempts: 1, initialDelayMs: 0 } },
      progressIntervalMs: 0,
    }),
  );

const status = async (m: ReturnType<typeof manager>, id: string) =>
  (await m.list()).find((each) => each.id === id)!;

describe('list() while an install runs', () => {
  it('carries the running install’s latest progress, and drops it once installed', async () => {
    const m = manager();
    server.next('/runtime', { holdAfterBytes: MiB / 2 });
    const held = server.waitForHold();
    const install = m.install('runtime');
    await held;
    // The held bytes reach the client a moment after the server stops sending.
    await expect.poll(async () => (await status(m, 'runtime')).progress?.phase).toBe('downloading');
    const running = await status(m, 'runtime');
    expect(running.installing).toBe(true);
    expect(running.progress).toMatchObject({ componentId: 'runtime', bytesTotal: runtime.size });
    expect(running.progress?.bytesDone).toBeGreaterThan(0);
    server.release();
    expect((await install).ok).toBe(true);
    const done = await status(m, 'runtime');
    expect(done).toMatchObject({ state: 'installed', installing: false });
    expect(done.progress).toBeUndefined();
  });
});

describe('list() after an install failed', () => {
  it('says why, on the component and on the one whose dependency stopped it; a retry that works clears it', async () => {
    const m = manager();
    server.next('/runtime', { status: 404 });
    const failed = await m.install('model');
    expect(failed).toMatchObject({ ok: false, error: { code: 'jobs.download_rejected' } });
    expect(await status(m, 'runtime')).toMatchObject({
      state: 'not_installed',
      installing: false,
      lastError: { code: 'jobs.download_rejected', params: { component: 'runtime', status: 404 } },
    });
    // The model never started its own download: its install failed because the runtime's did.
    expect(await status(m, 'model')).toMatchObject({
      state: 'not_installed',
      lastError: { code: 'jobs.download_rejected', params: { component: 'runtime' } },
    });

    expect((await m.install('model')).ok).toBe(true);
    for (const id of ['runtime', 'model']) {
      const after = await status(m, id);
      expect(after.state).toBe('installed');
      expect(after.lastError).toBeUndefined();
    }
  });

  it('keeps the reason for the next launch, and while a retry runs, until one works (UX2-DOWNLOADER)', async () => {
    server.next('/runtime', { status: 404 });
    expect((await manager().install('runtime')).ok).toBe(false);
    // A new manager over the same folder: the app launched again.
    const relaunched = manager();
    expect(await status(relaunched, 'runtime')).toMatchObject({
      state: 'not_installed',
      lastError: { code: 'jobs.download_rejected', detail: expect.stringContaining('404') },
    });
    server.next('/runtime', { holdAfterBytes: MiB / 2 });
    const held = server.waitForHold('/runtime');
    const retry = relaunched.install('runtime');
    await held;
    expect(await status(relaunched, 'runtime')).toMatchObject({
      installing: true,
      lastError: { code: 'jobs.download_rejected' },
    });
    server.release('/runtime');
    expect((await retry).ok).toBe(true);
    expect((await status(manager(), 'runtime')).lastError).toBeUndefined();
  });

  it('a cancelled install is not a failure', async () => {
    const m = manager();
    server.next('/runtime', { holdAfterBytes: MiB / 2 });
    const held = server.waitForHold();
    const controller = new AbortController();
    const install = m.install('runtime', { signal: controller.signal });
    await held;
    controller.abort();
    server.release();
    expect(await install).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    const after = await status(m, 'runtime');
    expect(after.lastError).toBeUndefined();
    expect(after.state).toBe('not_installed');
  });
});
