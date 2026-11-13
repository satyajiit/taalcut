// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX3-IDX: a development run installs components from a local release (TAALCUT_DEV_COMPONENTS). A packaged app
 * never does: the jobs process ignores the variable there (and main refuses to start with it, switches.test.ts).
 * The pending manifest points at the loopback server for the files the release holds, keeps hosted addresses for
 * the rest, and leaves out a pending build no one hosts; the manager installs from it checksummed, and a file
 * changed on disk fails its install.
 */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { createComponentManager } from '@taalcut/jobs';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
  devComponentSource,
  localReleaseManifest,
  managedNativesOnly,
  PUBLIC_BASE,
  startDevComponents,
} from '../src/utility/roots/dev-components';
import { ComponentManagerToken } from '../src/shared/tokens';
import { composeJobs } from '../src/utility/roots/jobs-root';
import { testConfig } from './helpers/roots';

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe('devComponentSource', () => {
  const env = { TAALCUT_DEV_COMPONENTS: '/home/me/release' };

  it('is off without the variable, on in a checkout, and refused in a packaged app', () => {
    expect(devComponentSource({}, false)).toEqual({ kind: 'off' });
    expect(devComponentSource({ TAALCUT_DEV_COMPONENTS: '  ' }, false)).toEqual({ kind: 'off' });
    expect(devComponentSource(env, false)).toEqual({ kind: 'on', releaseDirs: ['/home/me/release'] });
    // Several folders, as PATH separates them: a partial rebuild after the full release.
    expect(
      devComponentSource({ TAALCUT_DEV_COMPONENTS: `/r/cmp${delimiter}/r/trm${delimiter}` }, false),
    ).toEqual({ kind: 'on', releaseDirs: ['/r/cmp', '/r/trm'] });
    expect(devComponentSource(env, true)).toMatchObject({
      kind: 'refused',
      reason: expect.stringContaining('a packaged app installs only from its signed manifest') as string,
    });
  });

  it('runtimes come from components only in a packaged app and a run installing from a release', () => {
    expect(managedNativesOnly(true, {})).toBe(true);
    expect(managedNativesOnly(false, env)).toBe(true);
    expect(managedNativesOnly(false, {})).toBe(false);
  });
});

const artifact = (key: string, platform = 'linux-x64') => ({
  platform,
  urls: [`${PUBLIC_BASE}${key}`],
  sha256: 'a'.repeat(64),
  size: 1,
  install: { type: 'file', fileName: 'f' },
});
const component = (id: string, artifacts: ReturnType<typeof artifact>[], extra: object = {}) => ({
  id,
  version: '1',
  artifacts,
  dependencies: [],
  licence: { notice: { url: `${PUBLIC_BASE}${id}/1/NOTICE.txt` } },
  ...extra,
});

describe('localReleaseManifest', () => {
  it('serves what the release holds, keeps what is hosted, and drops a pending build nobody hosts', () => {
    const hosted = {
      schemaVersion: 1,
      components: [
        component('onnxruntime', [artifact('onnxruntime/1/mac.tar.zst', 'darwin-arm64')]),
        component('whisper-tiny', [artifact('whisper-tiny/1/ggml-tiny.bin', 'any')]),
      ],
    };
    const pending = {
      schemaVersion: 1,
      components: [
        component(
          'onnxruntime',
          [artifact('onnxruntime/1/mac.tar.zst', 'darwin-arm64'), artifact('onnxruntime/1/linux.tar.gz')],
          { variants: ['onnxruntime-cuda', 'onnxruntime-rocm'] },
        ),
        component('onnxruntime-cuda', [artifact('onnxruntime-cuda/1/linux.tar.gz')], {
          dependencies: ['cuda-runtime-13'],
        }),
        component('cuda-runtime-13', [artifact('cuda-runtime-13/1/linux.tar.gz')]),
        component('onnxruntime-rocm', [artifact('onnxruntime-rocm/1/linux.tar.gz')], {
          dependencies: ['rocm-runtime'],
        }),
        component('rocm-runtime', [artifact('rocm-runtime/1/linux.tar.gz')]),
        component('whisper-tiny', [artifact('whisper-tiny/1/ggml-tiny.bin', 'any')]),
      ],
    };
    const held = new Set([
      'onnxruntime/1/linux.tar.gz',
      'onnxruntime/1/NOTICE.txt',
      'onnxruntime-cuda/1/linux.tar.gz',
      'cuda-runtime-13/1/linux.tar.gz',
      'onnxruntime-rocm/1/linux.tar.gz',
    ]);
    const base = 'http://127.0.0.1:4567/';
    const built = localReleaseManifest({ pending, hosted, holds: (key) => held.has(key), base });
    const byId = new Map(
      (built.manifest.components as unknown as ReturnType<typeof component>[]).map((c) => [c.id, c]),
    );
    // rocm-runtime is pending and not in the release; what needs it goes too, and leaves the variant list.
    expect([...byId.keys()]).toEqual(['onnxruntime', 'onnxruntime-cuda', 'cuda-runtime-13', 'whisper-tiny']);
    expect(byId.get('onnxruntime')).toMatchObject({
      variants: ['onnxruntime-cuda'],
      artifacts: [
        { urls: [`${PUBLIC_BASE}onnxruntime/1/mac.tar.zst`] },
        { urls: [`${base}onnxruntime/1/linux.tar.gz`] },
      ],
      licence: { notice: { url: `${base}onnxruntime/1/NOTICE.txt` } },
    });
    expect(byId.get('onnxruntime-cuda')?.artifacts).toMatchObject([
      { urls: [`${base}onnxruntime-cuda/1/linux.tar.gz`] },
    ]);
    // A model the release doesn't rebuild comes from the host, notice included.
    expect(byId.get('whisper-tiny')).toMatchObject({
      artifacts: [{ urls: [`${PUBLIC_BASE}whisper-tiny/1/ggml-tiny.bin`] }],
      licence: { notice: { url: `${PUBLIC_BASE}whisper-tiny/1/NOTICE.txt` } },
    });
    expect(built.dropped).toEqual(['rocm-runtime linux-x64']);
    // The ROCm build's file stays unserved: what needs it went.
    expect(built.local).toBe(4);
  });
});

const TOOL = 'the tool’s bytes';
const NOTICE = 'NOTICE: the tool, MIT.';

/** A release folder as hosting/build.mjs writes it: objects/<key> and release.json listing them. */
async function writeRelease(releaseDir: string, files: Record<string, string>): Promise<string> {
  for (const [key, body] of Object.entries(files)) {
    await mkdir(join(releaseDir, 'objects', key, '..'), { recursive: true });
    await writeFile(join(releaseDir, 'objects', key), body);
  }
  const objects = Object.keys(files).map((key) => ({ key }));
  await writeFile(
    join(releaseDir, 'release.json'),
    JSON.stringify({ base: PUBLIC_BASE.slice(0, -1), components: [], objects }),
  );
  return releaseDir;
}

/** A release folder as hosting/build.mjs writes it, with a stand-in composer beside a stand-in signed manifest. */
async function release(files: Record<string, string>) {
  const root = await mkdtemp(join(tmpdir(), 'taalcut-dev-components-'));
  dirs.push(root);
  const releaseDir = await writeRelease(join(root, 'release'), files);
  const sha = (body: string) => createHash('sha256').update(body).digest('hex');
  const notice = NOTICE;
  const tool = {
    id: 'demo-tool',
    name: 'Demo tool',
    kind: 'tool',
    version: '1.0.0',
    tiers: ['minimum'],
    dependencies: [],
    artifacts: [
      {
        platform: 'any',
        urls: [`${PUBLIC_BASE}demo-tool/1.0.0/tool.bin`],
        sha256: sha(TOOL),
        size: Buffer.byteLength(TOOL),
        install: { type: 'file', fileName: 'tool.bin', executable: false },
      },
    ],
    licence: {
      spdx: 'MIT',
      notice: {
        url: `${PUBLIC_BASE}demo-tool/1.0.0/NOTICE.txt`,
        size: Buffer.byteLength(notice),
        sha256: sha(notice),
      },
    },
  };
  const tools = join(root, 'tools', 'components');
  await mkdir(tools, { recursive: true });
  await writeFile(
    join(tools, 'compose-provisional.mjs'),
    `const tool = ${JSON.stringify(tool)};
export function compose(read, { pending = false } = {}) {
  return { schemaVersion: 1, components: pending ? [tool] : [] };
}
`,
  );
  return { releaseDir, manifestPath: join(tools, 'manifest.signed.json') };
}

describe('startDevComponents', () => {
  it('serves the release on loopback and the manager installs from it, checksummed', async () => {
    const { releaseDir, manifestPath } = await release({
      'demo-tool/1.0.0/tool.bin': TOOL,
      'demo-tool/1.0.0/NOTICE.txt': NOTICE,
    });
    // A file in objects/ that release.json doesn't list isn't served.
    await writeFile(join(releaseDir, 'objects', 'unlisted.txt'), 'not in the release');
    const said: string[] = [];
    const started = await startDevComponents({
      releaseDirs: [releaseDir],
      manifestPath,
      log: (line) => said.push(line),
    });
    if (!started.ok) throw new Error(started.error.detail);
    try {
      expect(started.value.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
      expect(started.value.manifest.components[0]?.artifacts[0]?.urls).toEqual([
        `${started.value.base}demo-tool/1.0.0/tool.bin`,
      ]);
      expect(said.join('\n')).toContain('unsigned (development run only), 2 files from');
      const root = await mkdtemp(join(tmpdir(), 'taalcut-dev-components-root-'));
      dirs.push(root);
      const manager = createComponentManager({
        root,
        manifest: started.value.manifest,
        fetch: (url, init) => globalThis.fetch(url, init),
        log: () => undefined,
      });
      const installed = await manager.install('demo-tool');
      expect(installed.ok).toBe(true);
      if (installed.ok)
        expect(await readFile(join(installed.value.path, 'tool.bin'), 'utf8')).toBe('the tool’s bytes');
      await manager.close();
      // Only the objects release.json lists are served.
      expect((await fetch(`${started.value.base}demo-tool/1.0.0/tool.bin`)).status).toBe(200);
      expect((await fetch(`${started.value.base}unlisted.txt`)).status).toBe(404);
      expect((await fetch(`${started.value.base}..%2Frelease.json`)).status).toBe(404);
    } finally {
      await started.value.close();
    }
  });

  it('a file changed on disk fails its install', async () => {
    const { releaseDir, manifestPath } = await release({
      'demo-tool/1.0.0/tool.bin': TOOL,
      'demo-tool/1.0.0/NOTICE.txt': NOTICE,
    });
    const started = await startDevComponents({
      releaseDirs: [releaseDir],
      manifestPath,
      log: () => undefined,
    });
    if (!started.ok) throw new Error(started.error.detail);
    try {
      await writeFile(join(releaseDir, 'objects', 'demo-tool/1.0.0/tool.bin'), 'the tool’s Bytes');
      const root = await mkdtemp(join(tmpdir(), 'taalcut-dev-components-root-'));
      dirs.push(root);
      const manager = createComponentManager({
        root,
        manifest: started.value.manifest,
        fetch: (url, init) => globalThis.fetch(url, init),
        log: () => undefined,
      });
      const installed = await manager.install('demo-tool');
      expect(installed.ok ? 'installed' : installed.error.code).toBe('jobs.checksum_mismatch');
      await manager.close();
    } finally {
      await started.value.close();
    }
  });

  it('says why when the folder is no release', async () => {
    const root = await mkdtemp(join(tmpdir(), 'taalcut-dev-components-'));
    dirs.push(root);
    const started = await startDevComponents({
      releaseDirs: [root],
      manifestPath: join(root, 'manifest.signed.json'),
      log: () => undefined,
    });
    expect(started.ok ? 'started' : started.error.code).toBe('jobs.manifest_invalid');
  });

  it('a later folder’s file wins: a rebuilt notice over the full release’s stale one', async () => {
    const { releaseDir, manifestPath } = await release({
      'demo-tool/1.0.0/tool.bin': TOOL,
      'demo-tool/1.0.0/NOTICE.txt': 'NOTICE: an older text.',
    });
    const rebuild = await writeRelease(join(releaseDir, '..', 'rebuild'), {
      'demo-tool/1.0.0/NOTICE.txt': NOTICE,
    });
    const install = async (releaseDirs: string[]) => {
      const started = await startDevComponents({ releaseDirs, manifestPath, log: () => undefined });
      if (!started.ok) throw new Error(started.error.detail);
      const root = await mkdtemp(join(tmpdir(), 'taalcut-dev-components-root-'));
      dirs.push(root);
      const manager = createComponentManager({
        root,
        manifest: started.value.manifest,
        fetch: (url, init) => globalThis.fetch(url, init),
        log: () => undefined,
      });
      const installed = await manager.install('demo-tool');
      await manager.close();
      await started.value.close();
      return installed.ok ? 'installed' : installed.error.code;
    };
    expect(await install([releaseDir])).not.toBe('installed');
    expect(await install([releaseDir, rebuild])).toBe('installed');
  });
});

describe('the jobs process', () => {
  /** composeJobs with `packaged`, TAALCUT_DEV_COMPONENTS naming a release; what it logged, and its components. */
  async function jobsWith(packaged: boolean) {
    const { releaseDir } = await release({
      'demo-tool/1.0.0/tool.bin': TOOL,
      'demo-tool/1.0.0/NOTICE.txt': NOTICE,
    });
    const config = { ...testConfig('jobs'), packaged };
    // The checkout's tools/components beside the signed manifest (shared/component-manifest.ts).
    const manifestPath = join(releaseDir, '..', 'tools', 'components', 'manifest.signed.json');
    const warned: string[] = [];
    const spy = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.join(' '));
    });
    try {
      const root = composeJobs(
        { ...config, componentManifest: manifestPath },
        { jobs: [], pid: 1, env: { TAALCUT_DEV_COMPONENTS: releaseDir } },
      );
      const ids = (await root.container.resolve(ComponentManagerToken).list()).map((c) => c.id);
      await root.container.dispose();
      return { warned: warned.join('\n'), ids };
    } finally {
      spy.mockRestore();
    }
  }

  it('a checkout installs from the release', async () => {
    const { warned, ids } = await jobsWith(false);
    expect(warned).toContain('unsigned (development run only), 2 files from');
    expect(ids).toEqual(['demo-tool']);
  });

  it('a packaged app ignores TAALCUT_DEV_COMPONENTS and keeps its signed manifest', async () => {
    const { warned, ids } = await jobsWith(true);
    expect(warned).toContain(
      'TAALCUT_DEV_COMPONENTS is ignored: a packaged app installs only from its signed manifest',
    );
    expect(warned).not.toContain('unsigned (development run only)');
    // The stand-in signed manifest doesn't exist: refused, so nothing to install.
    expect(ids).toEqual([]);
  });
});
