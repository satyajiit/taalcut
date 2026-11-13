// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER: the download of everything this Mac needs, against a real local HTTP server (ranges, ETags,
 * faults on request): parallel lanes with dependencies first, a failure that doesn't stop the others, a dropped
 * connection that reconnects and resumes, a file that doesn't match its hash, the disk checked first, and the
 * numbers a window shows.
 */
import { rm } from 'node:fs/promises';
import { ok } from '@taalcut/core';
import type { ComponentManifest } from '@taalcut/jobs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { diskWithFree, listFiles, OpenedInTest, tempDir } from './helpers/fixtures';
import { BufferContent, TEST_NOTICE } from './helpers/content';
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

let server: TestServer;
let root: string;
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
  root = await tempDir('taalcut-set-');
  server.requests.length = 0;
});
afterEach(async () => {
  await opened.closeAll();
  server.release();
  await rm(root, { recursive: true, force: true });
});

const NEEDED = ['runtime', 'speech', 'search', 'shots', 'writing'];
const allInstalled = Object.fromEntries(NEEDED.map((id) => [id, 'installed']));

describe('everything this Mac needs', () => {
  it('lists what the tier needs, with what it depends on, and nothing on demand', async () => {
    const { set } = open(root, setManifest(server));
    const status = await set.status();
    expect(status.state).toBe('missing');
    expect(status.entries.map((e) => e.status.id).sort()).toEqual([...NEEDED].sort());
    // Nothing started: the bar is about everything that isn't here.
    const total = NEEDED.reduce((sum, id) => sum + SET_FILES[id as keyof typeof SET_FILES].size, 0);
    expect(status).toMatchObject({ bytesTotal: total, bytesDone: 0, bytesPerSecond: 0 });
    expect(status.requiredBytes).toBeGreaterThan(total);
    expect(server.requests).toEqual([]);
    // Each says what it can't run without, so a job is ready only once a shared runtime is too.
    const needs = Object.fromEntries(status.entries.map((e) => [e.status.id, e.needs]));
    expect(needs).toMatchObject({ speech: ['runtime'], search: ['runtime'], runtime: [], writing: [] });
    // A component the tier lists that can't run on this Mac (a Core ML model on an older macOS) isn't needed.
    const older = open(root, setManifest(server), {
      machine: async () => ok({ tier: 'recommended', runsHere: (id: string) => id !== 'shots' }),
    });
    expect((await older.set.status()).entries.map((e) => e.status.id)).not.toContain('shots');
  });

  it('downloads in parallel lanes, each component after what it depends on, and ends ready', async () => {
    const h = open(root, setManifest(server), { lanes: 2 });
    const started = await h.set.start();
    expect(started.ok).toBe(true);
    const done = await until(h.set, (s) => s.state === 'ready');
    expect(summary(done)).toEqual(allInstalled);
    expect(done.bytesDone).toBe(done.bytesTotal);
    expect(h.peak()).toBe(2);
    // The largest goes first (the long pole), the runtime next (smallest first); its models only once it's in.
    expect(h.events.slice(0, 2)).toEqual(['start:writing', 'start:runtime']);
    const endRuntime = h.events.indexOf('end:runtime');
    for (const dependent of ['speech', 'search'])
      expect(h.events.indexOf(`start:${dependent}`)).toBeGreaterThan(endRuntime);
    expect(await listFiles(root)).not.toContain('failures.json');
  });

  it('says ready only once its pass is over, not while an install is still recording its result', async () => {
    let release: () => void = () => undefined;
    const recorded = new Promise<void>((resolve) => (release = resolve));
    const h = open(root, setManifest(server), {
      afterInstall: async (id) => {
        if (id === 'writing') await recorded;
      },
    });
    expect((await h.set.start()).ok).toBe(true);
    // Every component is in the registry, but the pass hasn't heard the writing model's result yet.
    const listed = await until(h.set, (s) => s.entries.every((e) => e.state === 'installed'));
    expect(listed.state).toBe('downloading');
    release();
    expect((await until(h.set, (s) => s.state === 'ready')).entries).toHaveLength(NEEDED.length);
    expect(h.changes.at(-1)).toBe('state');
  });

  it('puts what a caller asks for first at the front, with what it needs', async () => {
    const h = open(root, setManifest(server), { lanes: 1 });
    expect((await h.set.start({ first: ['search'] })).ok).toBe(true);
    await until(h.set, (s) => s.state === 'ready');
    const starts = h.events.filter((e) => e.startsWith('start:'));
    expect(starts.slice(0, 3)).toEqual(['start:runtime', 'start:search', 'start:writing']);
    const outside = await open(root, setManifest(server)).set.start({ first: ['tool'] });
    expect(!outside.ok && outside.error).toMatchObject({
      code: 'core.validation',
      params: { field: 'first' },
    });
  });
});

describe('when something goes wrong', () => {
  it("doesn't stop the others when one fails; what depends on it says why; the set isn't ready", async () => {
    // A 404 isn't retried (another mirror might have it; this manifest has one).
    server.next('/runtime', { status: 404 });
    const h = open(root, setManifest(server));
    expect((await h.set.start()).ok).toBe(true);
    const stopped = await until(h.set, (s) => s.state !== 'downloading');
    expect(stopped.state).toBe('failed');
    expect(summary(stopped)).toEqual({
      runtime: 'failed',
      speech: 'failed',
      search: 'failed',
      shots: 'installed',
      writing: 'installed',
    });
    const byId = new Map(stopped.entries.map((e) => [e.status.id, e]));
    expect(byId.get('runtime')?.error).toMatchObject({
      code: 'jobs.download_rejected',
      params: { component: 'runtime', status: 404 },
    });
    // Speech never downloaded a byte: it waits on the runtime, and says the runtime's reason.
    expect(byId.get('speech')?.error).toMatchObject({ params: { component: 'runtime' } });
    expect(server.requestsFor('/speech')).toEqual([]);

    // Try again: the failed ones go again, and this time the server has the file.
    expect((await h.set.start()).ok).toBe(true);
    expect(summary(await until(h.set, (s) => s.state === 'ready'))).toEqual(allInstalled);
  });

  it('reconnects after a dropped connection, says so meanwhile, and resumes where it stopped', async () => {
    let wake: (() => void) | undefined;
    const sleep = (_ms: number) => new Promise<void>((resolve) => (wake = resolve));
    server.next('/writing', { dropAfterBytes: 1536 * KiB });
    const h = open(root, setManifest(server), {
      download: { sleep, retry: { maxAttempts: 3, initialDelayMs: 5_000 } },
    });
    expect((await h.set.start()).ok).toBe(true);
    const waiting = await until(h.set, (s) => s.entries.some((e) => e.progress?.retry !== undefined));
    const writing = waiting.entries.find((e) => e.status.id === 'writing');
    expect(writing).toMatchObject({
      state: 'downloading',
      progress: { phase: 'downloading', retry: { attempt: 1 } },
    });
    expect(writing?.progress?.retry?.at).toBeGreaterThan(Date.now());
    expect(waiting.state).toBe('downloading');
    wake?.();
    await until(h.set, (s) => s.state === 'ready');
    const [first, resumed] = server.requestsFor('/writing');
    expect(first).toMatchObject({ range: undefined, bytesSent: 1536 * KiB });
    // From what reached the disk: the last bytes the server sent may be lost with the connection.
    expect(resumed).toMatchObject({ ifRange: '"writing-1"', status: 206 });
    expect(resumed?.start).toBeGreaterThan(0);
    expect(resumed?.range).toBe(`bytes=${resumed?.start}-`);
    expect((resumed?.start ?? 0) + (resumed?.bytesSent ?? 0)).toBe(SET_FILES.writing.size);
  });

  it('deletes a file whose sha256 is wrong and says so on its row; the others install', async () => {
    const h = open(root, setManifest(server, ['shots']));
    expect((await h.set.start()).ok).toBe(true);
    const stopped = await until(h.set, (s) => s.state !== 'downloading');
    expect(stopped.state).toBe('failed');
    const shots = stopped.entries.find((e) => e.status.id === 'shots');
    expect(shots).toMatchObject({ state: 'failed', error: { code: 'jobs.checksum_mismatch' }, bytesDone: 0 });
    // The file that didn't match is gone; its verified licence notice stays for the next try.
    expect((await listFiles(root)).filter((f) => f.startsWith('downloads/'))).toEqual([
      `downloads/shots@1.0.0-${TEST_NOTICE.sha256().slice(0, 12)}.notice.download`,
    ]);
    expect(stopped.entries.filter((e) => e.state === 'installed')).toHaveLength(4);
  });

  it('checks the disk before anything downloads, and keeps the reason', async () => {
    const h = open(root, setManifest(server), { statfs: diskWithFree(100 * KiB) });
    const started = await h.set.start();
    expect(!started.ok && started.error).toMatchObject({
      code: 'jobs.downloads_space_low',
      params: { availableBytes: expect.any(Number), requiredBytes: expect.any(Number) },
      fix: { command: 'system.openStorage' },
    });
    expect(server.requests).toEqual([]);
    const status = await h.set.status();
    expect(status).toMatchObject({ state: 'failed', error: { code: 'jobs.downloads_space_low' } });
    expect(status.availableBytes).toBeLessThan(status.requiredBytes);
  });

  it("can't tell what this Mac needs without its tier: says why, starts nothing", async () => {
    const probe = { code: 'models.hardware_probe_failed', messageKey: 'x', retryable: true } as const;
    const h = open(root, setManifest(server), { machine: async () => ({ ok: false, error: probe }) });
    expect(await h.set.start()).toMatchObject({ ok: false, error: probe });
    expect(await h.set.status()).toMatchObject({ state: 'failed', entries: [], error: probe });
  });
});

describe('while it runs', () => {
  it('reports bytes, speed, time left and each lane', async () => {
    server.next('/writing', { holdAfterBytes: 2 * 1024 * KiB });
    const h = open(root, setManifest(server));
    expect((await h.set.start()).ok).toBe(true);
    await server.waitForHold('/writing');
    const running = await until(
      h.set,
      (s) => s.bytesPerSecond > 0 && s.entries.some((e) => e.status.id === 'writing' && e.bytesDone > 0),
    );
    expect(running.state).toBe('downloading');
    expect(running.bytesDone).toBeGreaterThan(0);
    expect(running.bytesDone).toBeLessThan(running.bytesTotal);
    expect(running.etaSeconds).toBeGreaterThan(0);
    expect(running.entries.find((e) => e.status.id === 'writing')).toMatchObject({ state: 'downloading' });
    expect(h.changes).toContain('progress');
    server.release('/writing');
    await until(h.set, (s) => s.state === 'ready');
  });
});

describe('a licence notice the manifest replaces (round 4)', () => {
  const CORRECTED = '/runtime/NOTICE-corrected.txt';
  const corrected = new BufferContent(
    Buffer.from('The runtime\n\nMIT License\n\n…\n\nBoringSSL: ISC License\n'),
  );
  /** The same manifest with `id`'s notice at a new key: no new version, no new file. */
  const withCorrectedNotice = (m: ComponentManifest, id: string): ComponentManifest => ({
    ...m,
    components: m.components.map((c) =>
      c.id === id
        ? {
            ...c,
            licence: {
              ...c.licence,
              notice: { url: server.url(CORRECTED), size: corrected.size, sha256: corrected.sha256() },
            },
          }
        : c,
    ),
  });

  it('that doesn’t arrive is a failed part with why, its files kept; Retry fetches only the notice', async () => {
    const first = open(root, setManifest(server));
    expect((await first.set.start()).ok).toBe(true);
    await until(first.set, (s) => s.state === 'ready');
    await first.close();
    server.requests.length = 0;

    server.serve(CORRECTED, { content: corrected, etag: '"c1"' });
    server.next(CORRECTED, { status: 404 });
    const h = open(root, withCorrectedNotice(setManifest(server), 'runtime'));
    await h.manager.refreshNotices();
    const failed = await h.set.status();
    expect(failed.state).toBe('failed');
    const runtime = failed.entries.find((e) => e.status.id === 'runtime');
    // Its files are all here (the bar counts them), its old notice still saved and linked.
    expect(runtime).toMatchObject({
      state: 'failed',
      error: { code: 'jobs.download_rejected', params: { component: 'runtime' } },
      bytesDone: SET_FILES.runtime.size,
    });
    expect(runtime?.status.installed?.notice).toMatch(/TAALCUT-NOTICE\.txt$/);
    // What runs on it stays installed.
    expect(summary(failed)).toMatchObject({ speech: 'installed', search: 'installed' });

    // Retry: the download starts again, and all it fetches is the notice.
    expect((await h.set.start()).ok).toBe(true);
    const ready = await until(h.set, (s) => s.state === 'ready');
    expect(summary(ready)).toEqual(allInstalled);
    expect(server.requestsFor('/runtime')).toEqual([]);
    expect(server.requestsFor(CORRECTED).map((r) => r.status)).toEqual([404, 200]);
  });
});
