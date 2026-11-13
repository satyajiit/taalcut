// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-TRM in the jobs process: NVIDIA's terms travel to the window with the CUDA runtime's row (accepted or not),
 * the download says what waits on them and what it brings in, and the agent's local runtime, which asks for the
 * build that runs here, gets the one the download picks: Vulkan until the terms are accepted, CUDA after.
 */
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { componentTermsFeatureId, downloadsSchema, ok, unwrap } from '@taalcut/core';
import {
  parseManifest,
  type ComponentStatus,
  type DownloadSetStatus,
  type MachineDescription,
  type TermsBook,
} from '@taalcut/jobs';
import { createFakeLocalRuntimeDriver, createLocalRuntime, llamaCppRuntimeSpec } from '@taalcut/models';
import {
  installAsAsked,
  signedComponentManager,
  type SignedComponents,
} from '../src/utility/roots/components';
import { downloadsReport } from '../src/utility/roots/downloads-wire';
import { componentList, usedByOf } from '../src/utility/roots/system-info';

const HOST = 'https://c.example/';
const sha256 = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const bytesOf = (id: string) => Buffer.from(`${id}\n`.repeat(4));
const NOTICE_BYTES = Buffer.from('NOTICE\n');
const NOTICE = { url: `${HOST}NOTICE.txt`, size: NOTICE_BYTES.length, sha256: sha256(NOTICE_BYTES) };
const NVIDIA = {
  owner: 'NVIDIA Corporation',
  termsVersion: '2026-10-27',
  documents: [
    { title: 'CUDA Toolkit End User License Agreement', url: 'https://docs.nvidia.com/cuda/eula/index.html' },
  ],
};
const CUDA_13 = { gpuApi: 'cuda', minDriver: '580', minComputeCapability: '7.5' };

function entry(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    version: '1',
    kind: 'runtime',
    licence: { spdx: 'MIT', notice: NOTICE },
    artifacts: [
      {
        platform: 'linux-x64',
        urls: [`${HOST}${id}`],
        sha256: sha256(bytesOf(id)),
        size: bytesOf(id).length,
        install: { type: 'file', fileName: id },
      },
    ],
    ...extra,
  };
}

const MANIFEST = unwrap(
  parseManifest({
    schemaVersion: 1,
    components: [
      entry('local-llm-runtime', {
        tiers: ['high'],
        variants: ['local-llm-runtime-cuda', 'local-llm-runtime-vulkan'],
      }),
      entry('local-llm-runtime-cuda', { requires: CUDA_13, dependencies: ['cuda-runtime-13'] }),
      entry('local-llm-runtime-vulkan', { requires: { gpuApi: 'vulkan' } }),
      entry('cuda-runtime-13', {
        requires: CUDA_13,
        licence: { spdx: 'LicenseRef-NVIDIA-CUDA-Toolkit-EULA', notice: NOTICE, acceptance: NVIDIA },
      }),
      // The weights the High tier's local model loads (not in the download here: no `tiers`).
      entry('local-llm-qwen3-5-4b', { kind: 'model' }),
      entry('local-llm-qwen3-5-4b-mmproj', { kind: 'model' }),
    ],
  }),
);

/** The components host: each file, and the licence notice beside it. */
const serve: typeof globalThis.fetch = (input) => {
  const asked = String(input);
  const body = asked === NOTICE.url ? NOTICE_BYTES : bytesOf(asked.slice(HOST.length));
  const response = new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
  // The downloader checks which URL answered; a constructed Response has none.
  Object.defineProperty(response, 'url', { value: asked });
  return Promise.resolve(response);
};

const RTX_4090_HOST: MachineDescription = {
  platform: 'linux',
  arch: 'x64',
  osVersion: '24.04',
  gpus: [
    { vendor: 'nvidia', apis: ['cuda', 'vulkan'], driverVersion: '615.71.09', computeCapability: '8.9' },
  ],
};

const book = (accepted: boolean): TermsBook => ({
  has: async (featureId, termsVersion) =>
    ok(
      accepted &&
        featureId === componentTermsFeatureId('cuda-runtime-13') &&
        termsVersion === NVIDIA.termsVersion,
    ),
});

const dirs: string[] = [];
const opened: SignedComponents[] = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((manager) => manager.close()));
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function open(accepted: boolean, root = mkdtempSync(join(tmpdir(), 'taalcut-terms-'))) {
  dirs.push(root);
  const logs: string[] = [];
  const manager = signedComponentManager({
    root,
    manifestPath: join(root, 'none.json'),
    release: true,
    manifest: MANIFEST,
    fetch: serve,
    log: (message) => logs.push(message),
    machine: async () => ok({ tier: 'high', machine: RTX_4090_HOST }),
    platform: 'linux-x64',
    terms: book(accepted),
  });
  opened.push(manager);
  return { manager, logs, root };
}

describe("NVIDIA's terms in the jobs process", () => {
  it('say what waits on them, with the terms on the row, until they are accepted', async () => {
    const { manager } = open(false);
    const set = await manager.downloads.status();
    const wire = downloadsSchema.parse(downloadsReport(set, usedByOf));
    expect(wire.components.map((c) => c.id)).toEqual(['local-llm-runtime-vulkan']);
    expect(wire.awaitingTerms).toEqual([
      {
        component: expect.objectContaining({
          id: 'cuda-runtime-13',
          status: 'not-installed',
          sizeBytes: bytesOf('cuda-runtime-13').length,
          terms: { ...NVIDIA, accepted: false },
        }),
        unlocks: ['local-llm-runtime-cuda'],
      },
    ]);
    const listed = componentList(await manager.list(), set, new Set(['cuda-runtime-13']));
    expect(listed.find((c) => c.id === 'cuda-runtime-13')?.terms?.accepted).toBe(false);
    expect(listed.find((c) => c.id === 'local-llm-runtime')).not.toHaveProperty('terms');
  });

  it('bring the CUDA runtime into the download once accepted, its row saying so', async () => {
    const { manager } = open(true);
    const wire = downloadsReport(await manager.downloads.status(), usedByOf);
    expect(wire).not.toHaveProperty('awaitingTerms');
    const cuda = wire.components.find((c) => c.id === 'cuda-runtime-13');
    expect(cuda?.terms).toEqual({ ...NVIDIA, accepted: true });
    expect(wire.components.map((c) => c.id)).toContain('local-llm-runtime-cuda');
  });

  it("give the local runtime the build the download picks: Vulkan, then CUDA once they're accepted", async () => {
    // The agent process's supervisor, its installs routed as the jobs root routes them (installAsAsked).
    const supervisor = (manager: SignedComponents) => {
      const driver = createFakeLocalRuntimeDriver(() => ({
        kind: 'openai-compatible',
        baseUrl: 'http://127.0.0.1:9/v1',
      }));
      const local = createLocalRuntime({
        spec: llamaCppRuntimeSpec('high'),
        installer: { install: installAsAsked(manager), get: (id) => manager.get(id) },
        driver,
        backends: ['cuda', 'vulkan', 'cpu'],
      });
      return { local, driver };
    };
    const before = open(false);
    const first = supervisor(before.manager);
    expect((await first.local.ensureInstalled('high')).ok).toBe(true);
    expect(before.logs).toContain(
      '[components] local-llm-runtime: installing local-llm-runtime-vulkan, the build that runs here',
    );
    for (const id of ['local-llm-runtime', 'local-llm-runtime-cuda', 'cuda-runtime-13'])
      expect(await before.manager.get(id)).toBeUndefined();
    expect((await first.local.start()).ok).toBe(true);
    expect(first.driver.launches[0]?.runtime.id).toBe('local-llm-runtime-vulkan');
    await first.local.stop();
    const refused = await before.manager.install('local-llm-runtime-cuda');
    expect(!refused.ok && refused.error.code).toBe('jobs.terms_not_accepted');
    await before.manager.close();

    const after = open(true, before.root);
    const second = supervisor(after.manager);
    expect((await second.local.ensureInstalled('high')).ok).toBe(true);
    expect(await after.manager.get('cuda-runtime-13')).toBeDefined();
    expect((await second.local.start()).ok).toBe(true);
    expect(second.driver.launches[0]?.runtimes?.map((r) => r.files.id)).toEqual([
      'local-llm-runtime-cuda',
      'local-llm-runtime-vulkan',
    ]);
    await second.local.stop();
  });
});

describe('a set status without terms', () => {
  it('maps to the wire without awaitingTerms', () => {
    const empty: DownloadSetStatus = {
      state: 'ready',
      entries: [],
      bytesTotal: 0,
      bytesDone: 0,
      bytesPerSecond: 0,
      requiredBytes: 0,
      awaitingTerms: [],
    };
    expect(downloadsReport(empty, usedByOf)).not.toHaveProperty('awaitingTerms');
    const plain = { id: 'x', licence: { spdx: 'MIT' } } as unknown as ComponentStatus;
    expect(plain.licence.acceptance).toBeUndefined();
  });
});
