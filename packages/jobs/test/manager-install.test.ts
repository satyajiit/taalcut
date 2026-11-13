// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ComponentManager.install against a local server: the acceptance cases (bad
 * checksum rejected and deleted, low disk space blocks with a plain error),
 * dependencies, archives, progress, idempotency and de-duplication.
 */
import { lstat, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createComponentManager, type ComponentManifest, type ComponentProgress } from '@taalcut/jobs';
import { BufferContent, DeterministicContent, TEST_NOTICE } from './helpers/content';
import {
  diskWithFree,
  listFiles,
  manifestOf,
  noSleep,
  OpenedInTest,
  PLATFORM,
  plentyOfSpace,
  tempDir,
} from './helpers/fixtures';
import { TestServer } from './helpers/server';
import { gzip, makeTar } from './helpers/tar';

const MiB = 1024 * 1024;
const model = new DeterministicContent(6 * MiB, 'model');
const runtimeTar = makeTar([
  { name: 'onnxruntime/lib/libonnxruntime.dylib', data: Buffer.alloc(300_000, 7), mode: 0o755 },
  { name: 'onnxruntime/LICENSE', data: 'MIT' },
]);
const runtime = new BufferContent(gzip(runtimeTar));

let server: TestServer;
let root: string;
const opened = new OpenedInTest();

beforeAll(async () => {
  server = await TestServer.start();
  server.serve('/model.bin', { content: model, etag: '"m1"' });
  server.serve('/runtime.tar.gz', { content: runtime, etag: '"r1"' });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  root = await tempDir();
  server.requests.length = 0;
});
afterEach(async () => {
  await opened.closeAll();
  await rm(root, { recursive: true, force: true });
});

function manifest(overrides: { modelSha?: string } = {}): ComponentManifest {
  return manifestOf(
    {
      id: 'onnxruntime',
      urls: [server.url('/runtime.tar.gz')],
      size: runtime.size,
      sha256: runtime.sha256(),
      platform: PLATFORM,
      archive: { format: 'tar.gz', extractedSize: 300_003, stripComponents: 1 },
    },
    {
      id: 'beat-this',
      urls: [server.url('/model.bin')],
      size: model.size,
      sha256: overrides.modelSha ?? model.sha256(),
      fileName: 'beat_this.onnx',
      dependencies: ['onnxruntime'],
    },
  );
}

function manager(m = manifest(), statfs = plentyOfSpace) {
  return opened.add(
    createComponentManager({
      root,
      manifest: m,
      fetch: globalThis.fetch,
      statfs,
      platform: PLATFORM,
      download: { sleep: noSleep },
      progressIntervalMs: 0,
    }),
  );
}

describe('install', () => {
  it('installs dependencies first, extracts archives and records both in the registry', async () => {
    const events: ComponentProgress[] = [];
    const result = await manager().install('beat-this', { onProgress: (p) => events.push(p) });
    expect(result.ok).toBe(true);
    const installed = result.ok ? result.value : undefined;
    expect(installed).toMatchObject({
      id: 'beat-this',
      version: '1.0.0',
      bytes: model.size + TEST_NOTICE.size,
      notice: join(installed?.path ?? '', 'TAALCUT-NOTICE.txt'),
    });
    expect(await readFile(installed!.file!)).toHaveLength(model.size);
    // Each licence notice first (small: a mismatch fails before the big file), then the file.
    expect(server.requests.map((r) => r.path)).toEqual([
      '/runtime.tar.gz.NOTICE.txt',
      '/runtime.tar.gz',
      '/model.bin.NOTICE.txt',
      '/model.bin',
    ]);

    const runtimeDir = (await manager().get('onnxruntime'))!.path;
    // The archive's own files exactly as published, and the verified notice beside them under Taalcut's name.
    expect(await listFiles(runtimeDir)).toEqual([
      'LICENSE',
      'TAALCUT-NOTICE.txt',
      'lib/libonnxruntime.dylib',
    ]);
    expect((await lstat(join(runtimeDir, 'lib/libonnxruntime.dylib'))).mode & 0o777).toBe(0o755);
    const notice = join(runtimeDir, 'TAALCUT-NOTICE.txt');
    expect(await readFile(notice)).toEqual(Buffer.concat([...TEST_NOTICE.chunks()]));
    expect((await lstat(notice)).mode & 0o777).toBe(0o644);
    const registry = JSON.parse(await readFile(join(root, 'registry.json'), 'utf8'));
    expect(Object.keys(registry.components).sort()).toEqual(['beat-this', 'onnxruntime']);
    expect(registry.components.onnxruntime).toMatchObject({
      notice: 'TAALCUT-NOTICE.txt',
      licence: { spdx: 'MIT', notice: { size: TEST_NOTICE.size, sha256: TEST_NOTICE.sha256() } },
    });
    // Nothing left behind but the installed files and the registry.
    expect((await listFiles(root)).filter((f) => !f.startsWith('installed/'))).toEqual(['registry.json']);

    const phases = (id: string) => [
      ...new Set(events.filter((e) => e.componentId === id).map((e) => e.phase)),
    ];
    expect(phases('onnxruntime')).toEqual([
      'checking',
      'downloading',
      'verifying',
      'extracting',
      'installing',
    ]);
    expect(phases('beat-this')).toEqual(['checking', 'downloading', 'verifying', 'installing']);
    const fractions = events.filter((e) => e.componentId === 'beat-this').map((e) => e.fraction);
    expect(fractions).toEqual([...fractions].sort((a, b) => a - b));
    expect(fractions.at(-1)).toBe(1);
  });

  it('is idempotent: an installed component returns at once without network', async () => {
    const first = await manager().install('beat-this');
    const again = await manager().install('beat-this');
    expect(again).toEqual(first);
    // Two files and their two notices, once.
    expect(server.requests).toHaveLength(4);
  });

  it('rejects a bad checksum, deletes the file and installs nothing', async () => {
    const m = manager(manifest({ modelSha: 'f'.repeat(64) }));
    const result = await m.install('beat-this');
    expect(result.ok).toBe(false);
    expect(!result.ok && result.error).toMatchObject({
      code: 'jobs.checksum_mismatch',
      messageKey: 'errors.jobs.checksum_mismatch',
      params: { component: 'beat-this' },
    });
    expect(server.requestsFor('/model.bin')[0]!.bytesSent).toBe(model.size);
    // The file that didn't match is gone; its verified notice stays for the next try.
    expect(await listFiles(join(root, 'downloads'))).toEqual([
      `beat-this@1.0.0-${TEST_NOTICE.sha256().slice(0, 12)}.notice.download`,
    ]);
    expect(await m.get('beat-this')).toBeUndefined();
    expect((await m.list()).find((s) => s.id === 'beat-this')).toMatchObject({
      state: 'not_installed',
      partialBytes: 0,
    });
  });

  it('blocks the download when the disk is low, with a plain message and a fix action', async () => {
    const free = 200 * MiB;
    const m = manager(manifest(), diskWithFree(free));
    const result = await m.install('beat-this');
    expect(result.ok).toBe(false);
    const error = !result.ok ? result.error : undefined;
    expect(error).toMatchObject({
      code: 'jobs.disk_space_low',
      messageKey: 'errors.jobs.disk_space_low',
      retryable: false,
      params: { component: 'beat-this', availableBytes: free },
      fix: { command: 'system.openStorage', labelKey: 'fix.openStorageSettings' },
    });
    // Download (with each licence notice) + extraction + 512 MiB headroom, for the model and its runtime.
    expect(error!.params!.requiredBytes).toBe(
      model.size + runtime.size + 2 * TEST_NOTICE.size + 300_003 + 512 * MiB,
    );
    expect(server.requests).toHaveLength(0);
    expect(await listFiles(join(root, 'downloads'))).toEqual([]);
  });

  it('checks each component again before its own download', async () => {
    let calls = 0;
    // Enough for the whole plan at first; then the disk fills up.
    const statfs = async () => ({ bavail: calls++ === 0 ? 2 ** 40 : 10, bsize: 4096 });
    const result = await manager(manifest(), statfs).install('onnxruntime');
    expect(!result.ok && result.error.code).toBe('jobs.disk_space_low');
    expect(server.requests).toHaveLength(0);
  });

  it('de-duplicates concurrent installs of the same component', async () => {
    const m = manager();
    const seen = { a: 0, b: 0 };
    const [a, b] = await Promise.all([
      m.install('beat-this', { onProgress: () => seen.a++ }),
      m.install('beat-this', { onProgress: () => seen.b++ }),
    ]);
    expect(a).toEqual(b);
    expect(a.ok).toBe(true);
    expect(server.requestsFor('/model.bin')).toHaveLength(1);
    expect(server.requestsFor('/runtime.tar.gz')).toHaveLength(1);
    expect(seen.a).toBeGreaterThan(0);
    expect(seen.b).toBeGreaterThan(0);
  });

  it('lets one caller cancel without stopping another; the last one out stops the download', async () => {
    const m = manager();
    await m.install('onnxruntime');
    server.next('/model.bin', { holdAfterBytes: 2 * MiB });
    const leaving = new AbortController();
    const held = server.waitForHold();
    const staying = m.install('beat-this');
    const left = m.install('beat-this', { signal: leaving.signal });
    await held;
    leaving.abort();
    expect((await left).ok).toBe(false);
    server.release();
    expect((await staying).ok).toBe(true);
    expect(server.requestsFor('/model.bin')).toHaveLength(1);

    // A sole caller cancelling stops the download and keeps the part for later.
    const m2 = manager(manifest());
    await m2.remove('beat-this');
    const controller = new AbortController();
    const cancelled = await m2.install('beat-this', {
      signal: controller.signal,
      onProgress: (p) => p.phase === 'downloading' && p.bytesDone >= 3 * MiB && controller.abort(),
    });
    expect(cancelled).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    const status = (await m2.list()).find((s) => s.id === 'beat-this')!;
    expect(status.partialBytes).toBeGreaterThan(0);
    expect((await m2.install('beat-this')).ok).toBe(true);
    expect(server.requestsFor('/model.bin').at(-1)!.range).toBe(`bytes=${status.partialBytes}-`);
  });

  it('fails cleanly for unknown ids, other platforms and corrupt archives', async () => {
    const m = manager();
    expect(await m.install('nope')).toMatchObject({ ok: false, error: { code: 'jobs.component_unknown' } });
    const intel = opened.add(
      createComponentManager({ root, manifest: manifest(), fetch: globalThis.fetch, platform: 'darwin-x64' }),
    );
    expect(await intel.install('beat-this')).toMatchObject({
      ok: false,
      error: {
        code: 'jobs.platform_unsupported',
        params: { component: 'onnxruntime', platform: 'darwin-x64' },
      },
    });

    const junk = new BufferContent(gzip(Buffer.from('this is not a tar archive at all, just text')));
    server.serve('/junk.tar.gz', { content: junk });
    const bad = manifestOf({
      id: 'junk',
      urls: [server.url('/junk.tar.gz')],
      size: junk.size,
      sha256: junk.sha256(),
      archive: { format: 'tar.gz', extractedSize: 100 },
    });
    const result = await manager(bad).install('junk');
    expect(!result.ok && result.error.code).toBe('jobs.extract_failed');
    // Nothing of the archive is left: only its verified licence notice and the record of why it failed, both kept
    // for the next try.
    expect(await listFiles(root)).toEqual([
      `downloads/junk@1.0.0-${TEST_NOTICE.sha256().slice(0, 12)}.notice.download`,
      'failures.json',
    ]);
  });

  it('keeps the verified download when cancelled during extraction, and installs from it offline', async () => {
    const m = manager();
    const controller = new AbortController();
    const cancelled = await m.install('onnxruntime', {
      signal: controller.signal,
      onProgress: (p) => p.phase === 'extracting' && controller.abort(),
    });
    expect(cancelled).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    // The verified archive and its verified notice.
    expect(await listFiles(join(root, 'downloads'))).toEqual(
      [
        `onnxruntime@1.0.0-${runtime.sha256().slice(0, 12)}.download`,
        `onnxruntime@1.0.0-${TEST_NOTICE.sha256().slice(0, 12)}.notice.download`,
      ].sort(),
    );
    expect(await listFiles(join(root, 'staging'))).toEqual([]);
    expect((await m.install('onnxruntime')).ok).toBe(true);
    // The notice and the archive, each once.
    expect(server.requests).toHaveLength(2);
  });

  it('plans the bytes still to fetch', async () => {
    const m = manager();
    const plan = await m.plan(['beat-this']);
    expect(plan.ok && plan.value).toMatchObject({
      components: [
        { id: 'onnxruntime', downloadBytes: runtime.size + TEST_NOTICE.size, extractBytes: 300_003 },
        { id: 'beat-this', downloadBytes: model.size + TEST_NOTICE.size, extractBytes: 0 },
      ],
      downloadBytes: runtime.size + model.size + 2 * TEST_NOTICE.size,
    });
    await m.install('onnxruntime');
    const after = await m.plan(['beat-this']);
    expect(after.ok && after.value.components.map((c) => c.id)).toEqual(['beat-this']);
    expect(await m.plan(['nope'])).toMatchObject({ ok: false, error: { code: 'jobs.component_unknown' } });
  });

  it('marks executables and reinstalls a component whose files were deleted by hand', async () => {
    const tool = manifestOf({
      id: 'yt-dlp',
      urls: [server.url('/model.bin')],
      size: model.size,
      sha256: model.sha256(),
      fileName: 'yt-dlp',
      executable: true,
    });
    const m = manager(tool);
    const first = await m.install('yt-dlp');
    expect(first.ok && (await lstat(first.value.file!)).mode & 0o777).toBe(0o755);
    await rm(first.ok ? first.value.path : '', { recursive: true });
    expect(await m.get('yt-dlp')).toBeUndefined();
    expect((await m.install('yt-dlp')).ok).toBe(true);
    // The file and its notice, twice: the notice went with the folder.
    expect(server.requests).toHaveLength(4);
  });
});

describe('disk space shared by concurrent installs', () => {
  const twoModels = () =>
    manifestOf(
      { id: 'model-a', urls: [server.url('/model.bin')], size: model.size, sha256: model.sha256() },
      { id: 'model-b', urls: [server.url('/model.bin')], size: model.size, sha256: model.sha256() },
    );
  // Room for one model and the headroom, not two. The fake volume never fills up, so only the
  // reservation of the install still running can tell the second one no.
  const free = 512 * MiB + model.size + MiB;

  it('counts an install that is still downloading, so two installs never plan on the same free bytes', async () => {
    const m = manager(twoModels(), diskWithFree(free));
    server.next('/model.bin', { holdAfterBytes: MiB });
    const held = server.waitForHold();
    const first = m.install('model-a');
    await held;
    const sameAgain = m.install('model-a'); // joins the running install; its bytes count once
    const second = await m.install('model-b');
    expect(second).toMatchObject({
      ok: false,
      error: {
        code: 'jobs.disk_space_low',
        params: { component: 'model-b', availableBytes: free - model.size - TEST_NOTICE.size },
      },
    });
    server.release();
    expect((await first).ok).toBe(true);
    expect((await sameAgain).ok).toBe(true);
    expect(server.requestsFor('/model.bin')).toHaveLength(1);
    // model-a's bytes are on disk now (a real statfs shows them), so its reservation is gone.
    expect((await m.install('model-b')).ok).toBe(true);
  });

  it('gives the reservation back when an install fails', async () => {
    const m = manager(twoModels(), diskWithFree(free));
    server.next('/model.bin', { status: 404 });
    expect((await m.install('model-a')).ok).toBe(false);
    expect((await m.install('model-b')).ok).toBe(true);
  });
});
