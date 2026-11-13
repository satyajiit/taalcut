// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's component manager over the shipped, signed manifest:
 * every build, a packaged release build included, trusts the release key that
 * signed it; a manifest no pinned key signed (and a missing file) is refused
 * with a log line and the app runs with no components instead of failing.
 * Packaging ships the manifest where main tells the jobs process to look.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { builderConfig } from '../packaging/builder-config';
import {
  COMPONENT_MANIFEST_FILE,
  COMPONENT_MANIFEST_SOURCE,
  componentManifestPath,
} from '../src/shared/component-manifest';
import { createHash, createPublicKey, generateKeyPairSync, sign } from 'node:crypto';
import { ok } from '@taalcut/core';
import { keyIdOf, signedMessage, type ComponentManifest } from '@taalcut/jobs';
import {
  refusesDevelopmentKey,
  signedComponentManager,
  type SignedComponents,
  type SignedComponentsOptions,
} from '../src/utility/roots/components';

const desktopDir = join(import.meta.dirname, '..');
const shipped = join(desktopDir, COMPONENT_MANIFEST_SOURCE);
const componentsDir = join(desktopDir, '..', '..', 'tools', 'components');
/**
 * The shipped manifest is every provisional manifest as one (compose-provisional.mjs writes
 * manifest.provisional.json), signed: compose and re-sign it when a provisional file changes.
 */
const PROVISIONAL = join(componentsDir, 'manifest.provisional.json');
interface ManifestFile {
  readonly components: readonly { readonly id: string }[];
}
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T;
const provisionalIds = () => readJson<ManifestFile>(PROVISIONAL).components.map((component) => component.id);

const dirs: string[] = [];
/** Closed as at quit before their folders go: one still writing would make the delete fail (ENOTEMPTY). */
const opened: SignedComponents[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((manager) => manager.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
const open = (options: SignedComponentsOptions): SignedComponents => {
  const manager = signedComponentManager(options);
  opened.push(manager);
  return manager;
};

/** The shipped manifest signed by a key no build pins, as the development key's signature now is. */
function signedByUnpinnedKey(): string {
  const { manifest } = readJson<{ manifest: unknown }>(shipped);
  const key = generateKeyPairSync('ed25519').privateKey;
  const keyId = keyIdOf(Buffer.from(createPublicKey(key).export({ format: 'jwk' }).x!, 'base64url'));
  const sig = sign(null, signedMessage(manifest), key).toString('base64');
  const dir = mkdtempSync(join(tmpdir(), 'taalcut-manifest-'));
  dirs.push(dir);
  const path = join(dir, COMPONENT_MANIFEST_FILE);
  writeFileSync(path, JSON.stringify({ manifest, signatures: [{ keyId, sig }] }));
  return path;
}

function setup(release: boolean, manifestPath = shipped) {
  const root = mkdtempSync(join(tmpdir(), 'taalcut-components-'));
  dirs.push(root);
  const logs: string[] = [];
  const manager = open({
    root,
    manifestPath,
    release,
    fetch: () => Promise.reject(new Error('no network in tests')),
    log: (message) => logs.push(message),
    machine: async () => ok({ tier: 'recommended' as const }),
    // The Mac's builds, on any host: the linux-x64 ones have their own test (packages/jobs' linux-manifest).
    platform: 'darwin-arm64',
  });
  return { manager, logs, root };
}

describe('signed component manifest', () => {
  it('ships one: main points a development run at the checkout and a packaged app at Resources', () => {
    expect(existsSync(shipped)).toBe(true);
    const utilityDir = join(desktopDir, 'out', 'utility');
    expect(componentManifestPath({ packaged: false, resourcesPath: '/R', utilityDir })).toBe(shipped);
    expect(componentManifestPath({ packaged: true, resourcesPath: '/R', utilityDir })).toBe(
      join('/R', COMPONENT_MANIFEST_FILE),
    );
    const config = builderConfig({}, desktopDir, {
      flavour: 'release',
      updateFeedUrl: undefined,
      updateChannel: undefined,
      crashDsn: undefined,
      telemetryUrl: undefined,
    });
    expect(config.extraResources).toContainEqual({ from: shipped, to: COMPONENT_MANIFEST_FILE });
  });

  it('ships the union of the provisional manifests, composed from them and signed as composed', async () => {
    // A plain .mjs tool script (no types), loaded by URL.
    const script = pathToFileURL(join(componentsDir, 'compose-provisional.mjs')).href;
    const { compose, SOURCES } = (await import(script)) as {
      compose(read?: (name: string) => unknown): ManifestFile;
      SOURCES: readonly string[];
    };
    const union = readJson<ManifestFile>(PROVISIONAL);
    expect(union).toEqual(compose((name) => readJson(join(componentsDir, name))));
    const fromSources = SOURCES.flatMap(
      (name) => readJson<ManifestFile>(join(componentsDir, name)).components,
    );
    expect(provisionalIds()).toEqual(fromSources.map((component) => component.id));
    // What indexing needs is in it, under the ids the jobs process asks for.
    expect(provisionalIds()).toEqual(
      expect.arrayContaining([
        'onnxruntime',
        'embeddinggemma-2',
        'ppocr-v5-devanagari',
        'transnetv2',
        'beat-this',
        'whisper-cpp',
        'whisper-tiny',
        'whisper-small-q8-0',
        'whisper-medium-q5-0',
      ]),
    );
    const signed = readJson<{ manifest: ManifestFile }>(shipped);
    expect(signed.manifest.components).toEqual((union as ManifestFile & { $comment?: string }).components);
  });

  it('a development build lists its components and records the accepted sequence', async () => {
    const { manager, logs, root } = setup(false);
    await manager.ready();
    expect((await manager.list()).map((component) => component.id)).toEqual(provisionalIds());
    expect(existsSync(join(root, 'manifest-state.json'))).toBe(true);
    expect(logs).toEqual([]);
  });

  it('a packaged release build trusts the shipped manifest: the pinned release key signed it', async () => {
    const { manager, logs } = setup(true);
    await manager.ready();
    expect((await manager.list()).map((component) => component.id)).toEqual(provisionalIds());
    expect(logs).toEqual([]);
  });

  it('a manifest no pinned key signed is refused, said, and the app runs with no components', async () => {
    const { manager, logs } = setup(true, signedByUnpinnedKey());
    expect(await manager.list()).toEqual([]);
    expect(logs.join('\n')).toMatch(/manifest refused: jobs\.manifest_untrusted \(unknown_key\)/);
    expect(logs.join('\n')).toMatch(/no trusted manifest/);
    // Every install says why, so the window can say it plainly (not "component unknown": UX2-MODELS).
    const refusal = { code: 'jobs.manifest_untrusted', params: { reason: 'unknown_key' } };
    for (const id of ['local-llm-runtime', 'whisper-tiny'])
      expect(await manager.install(id)).toMatchObject({ ok: false, error: refusal });
    // So does the download of everything this Mac needs (UX2-DOWNLOADER): it can't say what that is.
    expect(await manager.downloads.start()).toMatchObject({ ok: false, error: refusal });
    expect(await manager.downloads.status()).toMatchObject({ state: 'failed', entries: [], error: refusal });
    await manager.downloads.restore();
  });

  it('a development build knows everything this Mac needs, before anything downloads', async () => {
    const { manager } = setup(false);
    const status = await manager.downloads.status();
    expect(status.state).toBe('missing');
    const ids = status.entries.map((entry) => entry.status.id);
    // The tier's picks with their dependencies: the runtimes come with their models.
    expect(ids).toEqual(
      expect.arrayContaining(['onnxruntime', 'embeddinggemma-2', 'whisper-cpp', 'whisper-tiny']),
    );
    expect(ids).not.toContain('reference-fetcher');
    expect(status.bytesTotal).toBeGreaterThan(0);
  });

  it('a missing manifest is logged, not fatal', async () => {
    const { manager, logs, root } = setup(false, '/nonexistent/manifest.signed.json');
    expect(await manager.list()).toEqual([]);
    expect(await manager.get('local-llm-runtime')).toBeUndefined();
    expect(logs.join('\n')).toMatch(/jobs\.manifest_invalid/);
    expect(existsSync(join(root, 'manifest-state.json'))).toBe(false);
  });
});

describe('which builds refuse the development key (UX2-MODELS)', () => {
  it('a packaged release build only: `pnpm dev` bundles the release flavour but runs from the checkout', () => {
    expect(refusesDevelopmentKey({ flavour: 'release', packaged: true })).toBe(true);
    // The PO's dev app: apps/desktop/out/build-info.json said "release", and every component install was refused.
    expect(refusesDevelopmentKey({ flavour: 'release', packaged: false })).toBe(false);
    expect(refusesDevelopmentKey({ flavour: 'test', packaged: true })).toBe(false);
    expect(refusesDevelopmentKey({ flavour: 'test', packaged: false })).toBe(false);
  });
});

describe('after an install', () => {
  const bytes = Buffer.from('a tiny model');
  const url = 'https://components.test.invalid/tiny.bin';
  const notice = Buffer.from('Tiny\n\nMIT License\n');
  const noticeUrl = 'https://components.test.invalid/NOTICE.txt';
  const manifest: ComponentManifest = {
    schemaVersion: 1,
    components: [
      {
        id: 'tiny',
        name: 'Tiny',
        version: '1.0.0',
        kind: 'model',
        tiers: ['recommended'],
        licence: {
          spdx: 'MIT',
          notice: {
            url: noticeUrl,
            size: notice.length,
            sha256: createHash('sha256').update(notice).digest('hex'),
          },
        },
        dependencies: [],
        artifacts: [
          {
            platform: 'any',
            urls: [url],
            sha256: createHash('sha256').update(bytes).digest('hex'),
            size: bytes.length,
            install: { type: 'file', fileName: 'tiny.bin', executable: false },
          },
        ],
      },
    ],
  };
  // The host: the file, and its licence notice beside it.
  const serve: typeof globalThis.fetch = (input) => {
    const asked = String(input);
    const body = asked === noticeUrl ? notice : bytes;
    const response = new Response(body, {
      status: 200,
      headers: { 'content-length': String(body.length) },
    });
    // The downloader checks which URL answered; a constructed Response has none.
    Object.defineProperty(response, 'url', { value: asked });
    return Promise.resolve(response);
  };

  it('tells the jobs root, which wakes the stages waiting for a model', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taalcut-components-'));
    dirs.push(root);
    const installed: string[] = [];
    const manager = open({
      root,
      manifestPath: shipped,
      release: false,
      manifest,
      fetch: serve,
      log: () => {},
      onInstalled: (component) => installed.push(component.id),
      machine: async () => ok({ tier: 'recommended' as const }),
    });
    const first = await manager.install('tiny');
    expect(installed).toEqual(['tiny']);
    // Its verified licence notice is saved beside it, where Settings opens it (round 3).
    expect(first.ok && readFileSync(first.value.notice)).toEqual(notice);
    // Already installed: the install returns at once, and the stages are woken again (harmless).
    expect((await manager.install('tiny')).ok).toBe(true);
    expect(installed).toEqual(['tiny', 'tiny']);
    expect((await manager.install('nope')).ok).toBe(false);
    expect(installed).toEqual(['tiny', 'tiny']);
  });

  it('the download of everything this Mac needs wakes them too (UX2-DOWNLOADER)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'taalcut-components-'));
    dirs.push(root);
    const installed: string[] = [];
    const changes: string[] = [];
    const manager = open({
      root,
      manifestPath: shipped,
      release: false,
      manifest,
      fetch: serve,
      log: () => {},
      onInstalled: (component) => installed.push(component.id),
      machine: async () => ok({ tier: 'recommended' as const }),
      onDownloadsChange: (kind) => changes.push(kind),
    });
    expect((await manager.downloads.start()).ok).toBe(true);
    await expect.poll(async () => (await manager.downloads.status()).state).toBe('ready');
    expect(installed).toEqual(['tiny']);
    expect(changes).toContain('state');
    // Quit: the download stops, then the manager; nothing starts after, and the folder deletes at once.
    await manager.close();
    expect(await manager.downloads.start()).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    expect(await manager.install('tiny')).toMatchObject({ ok: false, error: { code: 'core.cancelled' } });
    rmSync(root, { recursive: true });
  });
});
