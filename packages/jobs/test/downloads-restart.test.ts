// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER: the download of everything this Mac needs across restarts, against the local test server. A
 * process killed mid-download is picked up by the next launch on its own, from the bytes on disk; pause keeps
 * the partial files and survives a restart until resumed; cancel deletes them; a component's last failure is still
 * on its row after a restart. Every test quits as the app does (the set stops, then the manager) and deletes the
 * folder at once: nothing may still be writing to it.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listFiles, OpenedInTest, tempDir } from './helpers/fixtures';
import { componentLayout, partPathFor } from '../src/components/layout';
import { TestServer } from './helpers/server';
import {
  KiB,
  makeSet,
  serveSet,
  SET_FILES,
  setManifest,
  summary,
  until,
  type SetHarness,
} from './helpers/set-fixtures';

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const childScript = join(packageDir, 'test', 'helpers', 'set-child.ts');
const HELD = 1024 * KiB;

let server: TestServer;
let root: string;
let child: ChildProcess | undefined;
const opened = new OpenedInTest();
const open = (...args: Parameters<typeof makeSet>): SetHarness => opened.add(makeSet(...args));

beforeAll(async () => {
  server = await TestServer.start();
  serveSet(server);
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  root = await tempDir('taalcut-set-restart-');
  server.requests.length = 0;
});
afterEach(async () => {
  child?.kill('SIGKILL');
  child = undefined;
  // Quit as the app does, while the server still holds what it holds: closing mustn't wait for the network.
  await opened.closeAll();
  server.release();
  // No retry: a write landing after close would make this fail with ENOTEMPTY.
  await rm(root, { recursive: true, force: true });
});

/** Every file and folder under `dir`, with its size and when it last changed. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  const sized = await Promise.all(
    entries.map(async (entry) => {
      const path = join(entry.parentPath, entry.name);
      const info = await stat(path);
      return [
        path.slice(dir.length + 1),
        `${entry.isDirectory() ? 'dir' : info.size}@${info.mtimeMs}`,
      ] as const;
    }),
  );
  return Object.fromEntries(sized);
}

/** Closed means closed: nothing under `root` changes for a while after, and it can be deleted at once. */
async function expectQuietAfterClose(): Promise<void> {
  const before = await snapshot(root);
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(await snapshot(root)).toEqual(before);
  await rm(root, { recursive: true });
}

const writingPart = () => partPathFor(componentLayout(root), 'writing', '1.0.0', SET_FILES.writing.sha256());

async function partSize(): Promise<number> {
  return stat(writingPart()).then(
    (s) => s.size,
    () => 0,
  );
}

async function waitForPart(bytes: number): Promise<void> {
  const deadline = Date.now() + 15_000;
  while ((await partSize()) < bytes) {
    if (Date.now() > deadline) throw new Error(`the part never reached ${bytes} bytes`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

describe('across restarts', () => {
  it('a launch after a kill mid-download picks it up on its own, from the bytes on disk', async () => {
    const manifest = setManifest(server);
    const manifestPath = join(root, '..', `${root.split('/').pop()}-manifest.json`);
    await writeFile(manifestPath, JSON.stringify(manifest));
    server.next('/writing', { holdAfterBytes: HELD });
    const held = server.waitForHold('/writing');
    child = spawn(process.execPath, ['--import', 'tsx', childScript, root, manifestPath], {
      cwd: packageDir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = once(child, 'exit');
    await Promise.race([held, exited.then(() => Promise.reject(new Error(`child exited early: ${stderr}`)))]);
    await waitForPart(HELD);
    child.kill('SIGKILL');
    await exited;
    await rm(manifestPath, { force: true });
    expect(await partSize()).toBe(HELD);

    // "Launch the app again": a new manager and set over the same folder. Nobody presses anything.
    const h = open(root, manifest);
    await h.set.restore();
    const ready = await until(h.set, (s) => s.state === 'ready');
    expect(summary(ready)).toMatchObject({ writing: 'installed', speech: 'installed' });
    const resumed = server.requestsFor('/writing').at(-1);
    expect(resumed).toMatchObject({ range: `bytes=${HELD}-`, ifRange: '"writing-1"', status: 206 });
    expect(resumed?.bytesSent).toBe(SET_FILES.writing.size - HELD);
  }, 30_000);

  it('pause keeps the partial file and stays paused after a restart; resume asks for the rest', async () => {
    const manifest = setManifest(server);
    server.next('/writing', { holdAfterBytes: HELD });
    const first = open(root, manifest);
    expect((await first.set.start()).ok).toBe(true);
    await server.waitForHold('/writing');
    await waitForPart(HELD);
    const paused = await first.set.pause();
    expect(paused.state).toBe('paused');
    expect(paused.entries.find((e) => e.status.id === 'writing')).toMatchObject({
      state: 'paused',
      bytesDone: HELD,
    });
    expect(paused.bytesPerSecond).toBe(0);
    server.release('/writing');

    const second = open(root, manifest);
    await second.set.restore();
    expect((await second.set.status()).state).toBe('paused');
    expect(second.events).toEqual([]);

    expect((await second.set.start()).ok).toBe(true);
    await until(second.set, (s) => s.state === 'ready');
    expect(server.requestsFor('/writing').at(-1)).toMatchObject({ range: `bytes=${HELD}-`, status: 206 });
  });

  it('cancel deletes the partial files and leaves what is installed', async () => {
    const manifest = setManifest(server);
    server.next('/writing', { holdAfterBytes: HELD });
    const h = open(root, manifest);
    expect((await h.set.start()).ok).toBe(true);
    await server.waitForHold('/writing');
    await waitForPart(HELD);
    await until(h.set, (s) => s.entries.filter((e) => e.state === 'installed').length >= 2);
    const cancelled = await h.set.cancel();
    server.release('/writing');
    expect(cancelled.state).toBe('missing');
    expect(cancelled.entries.find((e) => e.status.id === 'writing')).toMatchObject({
      state: 'missing',
      bytesDone: 0,
    });
    expect((await listFiles(root)).filter((f) => f.startsWith('downloads/'))).toEqual([]);
    expect(cancelled.entries.some((e) => e.state === 'installed')).toBe(true);
    // Nothing goes on by itself at the next launch.
    const next = open(root, manifest);
    await next.set.restore();
    expect(next.events).toEqual([]);
  });

  it("keeps a component's last failure for the next launch, until an install of it works", async () => {
    const manifest = setManifest(server, ['shots']);
    const h = open(root, manifest);
    expect((await h.set.start()).ok).toBe(true);
    await until(h.set, (s) => s.state === 'failed');

    const relaunched = open(root, manifest);
    const status = await relaunched.set.status();
    expect(status.state).toBe('failed');
    expect(status.entries.find((e) => e.status.id === 'shots')).toMatchObject({
      state: 'failed',
      error: { code: 'jobs.checksum_mismatch', params: { component: 'shots' } },
    });
    expect(status.entries.find((e) => e.status.id === 'shots')?.status.lastError?.detail).toContain('sha256');

    // A later manifest with the right file: the reason goes once it installs.
    const fixed = open(root, setManifest(server));
    expect((await fixed.set.start()).ok).toBe(true);
    const ready = await until(fixed.set, (s) => s.state === 'ready');
    expect(ready.entries.every((e) => e.error === undefined)).toBe(true);
    // Ready shows once the install is registered; forgetting the old failure is written just after. Quitting
    // now waits for that write (it once landed during the folder's delete: ENOTEMPTY).
    await Promise.all([h.close(), relaunched.close(), fixed.close()]);
    await expectQuietAfterClose();
  });

  it('quit mid-download: once closed, nothing under its folder changes and the folder deletes at once', async () => {
    const manifest = setManifest(server);
    server.next('/writing', { holdAfterBytes: HELD });
    server.next('/tool', { holdAfterBytes: 16 * KiB });
    const held = Promise.all([server.waitForHold('/writing'), server.waitForHold('/tool')]);
    const h = open(root, manifest);
    expect((await h.set.start()).ok).toBe(true);
    // Settings' Install on the on-demand tool: an install the set doesn't own, which close stops too.
    const tool = h.manager.install('tool');
    await held;
    await waitForPart(HELD);
    // Other parts may be mid-download, mid-unpack or mid-registry-write: close waits for each.
    await h.close();
    expect(await tool).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(await partSize()).toBe(HELD);
    // The server would send the rest now; nobody is listening.
    server.release();
    await expectQuietAfterClose();
    // A start after close does nothing: the folder stays gone.
    expect(await h.set.start()).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(await h.manager.install('writing')).toMatchObject({
      ok: false,
      error: { code: 'core.cancelled' },
    });
    await expect(stat(root)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
