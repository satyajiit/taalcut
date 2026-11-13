// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * ComponentManager after install: list, update when the manifest changes,
 * remove with cleanup, and recovery from crash debris and a corrupt registry.
 */
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createComponentManager, type ComponentManifest } from '@taalcut/jobs';
import { InstalledRegistry } from '../src/components/registry';
import { DeterministicContent, TEST_NOTICE } from './helpers/content';
import {
  listFiles,
  manifestOf,
  MIT_LICENCE,
  noSleep,
  OpenedInTest,
  PLATFORM,
  plentyOfSpace,
  tempDir,
  type FileComponentSpec,
} from './helpers/fixtures';
import { TestServer } from './helpers/server';

const MiB = 1024 * 1024;
const runtimeV1 = new DeterministicContent(1 * MiB, 'runtime-1');
const runtimeV2 = new DeterministicContent(1 * MiB + 77, 'runtime-2');
const model = new DeterministicContent(2 * MiB, 'model');

let server: TestServer;
let root: string;
const opened = new OpenedInTest();

beforeAll(async () => {
  server = await TestServer.start();
  server.serve('/runtime-1', { content: runtimeV1 });
  server.serve('/runtime-2', { content: runtimeV2 });
  server.serve('/model', { content: model });
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

function manifest(runtimeVersion: 1 | 2 = 1, extra: FileComponentSpec[] = []): ComponentManifest {
  const runtime = runtimeVersion === 1 ? runtimeV1 : runtimeV2;
  return manifestOf(
    {
      id: 'runtime',
      version: `${runtimeVersion}.0.0`,
      urls: [server.url(`/runtime-${runtimeVersion}`)],
      size: runtime.size,
      sha256: runtime.sha256(),
    },
    {
      id: 'model',
      urls: [server.url('/model')],
      size: model.size,
      sha256: model.sha256(),
      dependencies: ['runtime'],
      tiers: ['recommended', 'high'],
    },
    ...extra,
  );
}

const manager = (m: ComponentManifest = manifest()) =>
  opened.add(
    createComponentManager({
      root,
      manifest: m,
      fetch: globalThis.fetch,
      statfs: plentyOfSpace,
      platform: PLATFORM,
      download: { sleep: noSleep },
      now: () => Date.parse('2026-10-12T12:00:00Z'),
    }),
  );

describe('list and update', () => {
  it('lists states, then updates what the new manifest changed and deletes the old version', async () => {
    const unsupported: FileComponentSpec = {
      id: 'win-only',
      urls: [server.url('/model')],
      size: model.size,
      sha256: model.sha256(),
      platform: 'win32-x64',
    };
    const v1 = manager(manifest(1, [unsupported]));
    expect((await v1.list()).map((s) => [s.id, s.state])).toEqual([
      ['runtime', 'not_installed'],
      ['model', 'not_installed'],
      ['win-only', 'unsupported'],
    ]);
    expect((await v1.install('model')).ok).toBe(true);
    const oldRuntime = (await v1.get('runtime'))!;
    expect(oldRuntime).toMatchObject({ version: '1.0.0', installedAt: '2026-10-12T12:00:00.000Z' });

    const v2 = manager(manifest(2));
    const listed = await v2.list();
    expect(listed.map((s) => [s.id, s.state])).toEqual([
      ['runtime', 'update_available'],
      ['model', 'installed'],
    ]);
    expect(listed[0]).toMatchObject({
      installed: { version: '1.0.0' },
      downloadBytes: runtimeV2.size,
      installing: false,
    });

    const updated = await v2.updateAll();
    expect(updated).toEqual({ ok: true, value: ['runtime'] });
    const newRuntime = (await v2.get('runtime'))!;
    expect(newRuntime.version).toBe('2.0.0');
    expect(newRuntime.path).not.toBe(oldRuntime.path);
    expect(await readdir(join(root, 'installed', 'runtime'))).toEqual([newRuntime.path.split('/').at(-1)]);
    expect((await v2.updateAll()).ok && (await v2.updateAll())).toEqual({ ok: true, value: [] });
  });
});

describe('remove', () => {
  it('removes files, partial downloads and the registry entry, and reports the freed bytes', async () => {
    const m = manager();
    await m.install('model');
    await mkdir(join(root, 'downloads'), { recursive: true });
    await writeFile(join(root, 'downloads', 'model@1.0.0-aaaaaaaaaaaa.part'), 'stale');

    expect(await m.remove('runtime')).toMatchObject({
      ok: false,
      error: { code: 'jobs.component_required', params: { component: 'runtime', requiredBy: 'model' } },
    });
    // Its files and the licence notice saved beside them.
    expect(await m.remove('model')).toEqual({
      ok: true,
      value: { freedBytes: model.size + TEST_NOTICE.size },
    });
    expect(await m.get('model')).toBeUndefined();
    expect(await listFiles(join(root, 'installed', 'model'))).toEqual([]);
    expect(await listFiles(join(root, 'downloads'))).toEqual([]);
    expect(await m.remove('runtime')).toEqual({
      ok: true,
      value: { freedBytes: runtimeV1.size + TEST_NOTICE.size },
    });
    expect(await m.remove('model')).toEqual({ ok: true, value: { freedBytes: 0 } });
    expect(await m.remove('ghost')).toMatchObject({ ok: false, error: { code: 'jobs.component_unknown' } });
    expect(await listFiles(root)).toEqual(['registry.json']);
  });

  it('force-removes a needed component, and cancels an install that is running', async () => {
    const m = manager();
    await m.install('model');
    expect((await m.remove('runtime', { force: true })).ok).toBe(true);

    server.next('/model', { holdAfterBytes: MiB });
    await m.remove('model');
    const held = server.waitForHold();
    const installing = m.install('model');
    await held;
    expect((await m.list()).find((s) => s.id === 'model')!.installing).toBe(true);
    expect((await m.remove('model')).ok).toBe(true);
    expect(await installing).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(await listFiles(join(root, 'downloads'))).toEqual([]);
    expect(await m.get('model')).toBeUndefined();
  });
});

describe('recovery', () => {
  it('sweeps crash debris at startup but keeps resumable downloads of current versions', async () => {
    await manager().install('runtime');
    const modelKey = `model@1.0.0-${model.sha256().slice(0, 12)}`;
    await mkdir(join(root, 'staging', 'model@1.0.0-dead'), { recursive: true });
    await mkdir(join(root, 'installed', 'orphan', '1.0.0-x'), { recursive: true });
    await mkdir(join(root, 'installed', 'runtime', '0.9.0-old'), { recursive: true });
    await writeFile(join(root, 'downloads', `${modelKey}.part`), 'resume me');
    await writeFile(join(root, 'downloads', 'model@0.9.0-oldoldoldold.part'), 'stale');
    // A licence notice's part file is kept or swept the same way as its component's.
    const noticeKey = `model@1.0.0-${TEST_NOTICE.sha256().slice(0, 12)}.notice`;
    await writeFile(join(root, 'downloads', `${noticeKey}.part`), 'resume me');
    await writeFile(join(root, 'downloads', 'model@0.9.0-oldoldoldold.notice.part'), 'stale');
    await writeFile(join(root, 'registry.json.abc123.tmp'), '{');

    await manager().list();
    const runtimeDir = `installed/runtime/1.0.0-${runtimeV1.sha256().slice(0, 12)}`;
    expect(await listFiles(root)).toEqual([
      ...[`downloads/${modelKey}.part`, `downloads/${noticeKey}.part`].sort(),
      `${runtimeDir}/TAALCUT-NOTICE.txt`,
      `${runtimeDir}/runtime.bin`,
      'registry.json',
    ]);
  });

  it('treats a corrupt registry as empty and moves it aside', async () => {
    await mkdir(root, { recursive: true });
    await writeFile(join(root, 'registry.json'), '{"schemaVersion": 1, "components": {"x": 1}}');
    const m = manager();
    expect(await m.get('runtime')).toBeUndefined();
    expect((await readdir(root)).filter((n) => n.startsWith('registry.json.corrupt-'))).toHaveLength(1);
    expect((await m.install('runtime')).ok).toBe(true);
    const registry = JSON.parse(await readFile(join(root, 'registry.json'), 'utf8'));
    expect(Object.keys(registry.components)).toEqual(['runtime']);
  });

  it('serialises concurrent registry writes', async () => {
    const path = join(root, 'registry.json');
    const registry = await InstalledRegistry.load(path);
    const entry = (id: string) => ({
      id,
      version: '1',
      sha256: 'a'.repeat(64),
      platform: 'any',
      dir: `installed/${id}/1`,
      bytes: 1,
      installedAt: 'now',
      licence: MIT_LICENCE,
      notice: 'TAALCUT-NOTICE.txt',
    });
    await Promise.all(['a', 'b', 'c'].map((id) => registry.put(entry(id))));
    expect(await registry.delete('b')).toMatchObject({ id: 'b' });
    const reloaded = await InstalledRegistry.load(path);
    expect(reloaded.list().map((e) => e.id)).toEqual(['a', 'c']);
  });
});
