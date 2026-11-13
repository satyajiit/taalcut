// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-CMP: the download of everything a Linux machine needs picks its accelerator builds by what the machine has
 * (seam 4). On the RTX 4090 host it installs the CUDA builds and the CUDA runtime they need, checksummed, from a
 * local server; on a machine without a GPU only the CPU builds. The component ids and requirements mirror
 * tools/components (onnxruntime-cuda, local-llm-runtime-cuda, cuda-runtime-13).
 */
import { rm } from 'node:fs/promises';
import { ok } from '@taalcut/core';
import type { MachineDescription } from '@taalcut/jobs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DeterministicContent } from './helpers/content';
import { manifestOf, OpenedInTest, tempDir, type FileComponentSpec } from './helpers/fixtures';
import { TestServer } from './helpers/server';
import { KiB, makeSet, summary, until, type SetHarness } from './helpers/set-fixtures';

const CUDA_13 = { gpuApi: 'cuda', minDriver: '580', minComputeCapability: '7.5' };
const FILES = {
  onnxruntime: new DeterministicContent(64 * KiB, 'v-ort'),
  'onnxruntime-cuda': new DeterministicContent(256 * KiB, 'v-ort-cuda'),
  'cuda-runtime-13': new DeterministicContent(512 * KiB, 'v-cuda'),
  'local-llm-runtime': new DeterministicContent(32 * KiB, 'v-llama'),
  'local-llm-runtime-cuda': new DeterministicContent(128 * KiB, 'v-llama-cuda'),
  'local-llm-runtime-vulkan': new DeterministicContent(48 * KiB, 'v-llama-vk'),
  'embeddinggemma-2': new DeterministicContent(96 * KiB, 'v-gemma'),
} as const;
type Id = keyof typeof FILES;
const EXTRA: Partial<Record<Id, Partial<FileComponentSpec>>> = {
  onnxruntime: { tiers: ['high'], variants: ['onnxruntime-cuda'] },
  'onnxruntime-cuda': { requires: CUDA_13, dependencies: ['cuda-runtime-13'] },
  'cuda-runtime-13': { requires: CUDA_13 },
  'local-llm-runtime': { tiers: ['high'], variants: ['local-llm-runtime-cuda', 'local-llm-runtime-vulkan'] },
  'local-llm-runtime-cuda': { requires: CUDA_13, dependencies: ['cuda-runtime-13'] },
  'local-llm-runtime-vulkan': { requires: { gpuApi: 'vulkan' } },
  'embeddinggemma-2': { tiers: ['high'], platform: 'any', dependencies: ['onnxruntime'] },
};

const RTX_4090_HOST: MachineDescription = {
  platform: 'linux',
  arch: 'x64',
  osVersion: '24.04',
  gpus: [
    { vendor: 'nvidia', apis: ['cuda', 'vulkan'], driverVersion: '615.71.09', computeCapability: '8.9' },
  ],
};
/** The same host with `CUDA_VISIBLE_DEVICES=-1`: the probe reports no GPU. */
const GPU_HIDDEN: MachineDescription = { ...RTX_4090_HOST, gpus: [] };

let server: TestServer;
let root: string;
const opened = new OpenedInTest();

beforeAll(async () => {
  server = await TestServer.start();
  for (const [id, content] of Object.entries(FILES)) server.serve(`/${id}`, { content, etag: `"${id}"` });
});
afterAll(async () => {
  await server.close();
});
beforeEach(async () => {
  root = await tempDir('taalcut-variants-');
  server.requests.length = 0;
});
afterEach(async () => {
  await opened.closeAll();
  server.release();
  await rm(root, { recursive: true, force: true });
});

function linuxSet(machine: MachineDescription, log: string[] = []): SetHarness {
  const manifest = manifestOf(
    ...Object.entries(FILES).map(([id, content]) => ({
      id,
      urls: [server.url(`/${id}`)],
      size: content.size,
      sha256: content.sha256(),
      platform: 'linux-x64',
      ...EXTRA[id as Id],
    })),
  );
  return opened.add(
    makeSet(root, manifest, {
      platform: 'linux-x64',
      machine: async () => ok({ tier: 'high', machine }),
      log: (message) => log.push(message),
    }),
  );
}

describe('accelerator builds on Linux', () => {
  it('installs the CUDA builds and the CUDA runtime on the RTX 4090 host, checksummed', async () => {
    const log: string[] = [];
    const h = linuxSet(RTX_4090_HOST, log);
    const needed = (await h.set.status()).entries.map((e) => e.status.id).sort();
    // onnxruntime stays: the models name it, and its CUDA build is added beside it.
    expect(needed).toEqual(
      [
        'cuda-runtime-13',
        'embeddinggemma-2',
        'local-llm-runtime-cuda',
        'onnxruntime',
        'onnxruntime-cuda',
      ].sort(),
    );
    expect((await h.set.start()).ok).toBe(true);
    const done = await until(h.set, (s) => s.state === 'ready');
    expect(Object.values(summary(done)).every((state) => state === 'installed')).toBe(true);
    const installed = await h.manager.get('onnxruntime-cuda');
    expect(installed?.sha256).toBe(FILES['onnxruntime-cuda'].sha256());
    expect(log).toContain('[components] local-llm-runtime: local-llm-runtime-cuda');
  });

  it('takes only the CPU builds with the GPU hidden, and says why', async () => {
    const log: string[] = [];
    const h = linuxSet(GPU_HIDDEN, log);
    const needed = (await h.set.status()).entries.map((e) => e.status.id).sort();
    expect(needed).toEqual(['embeddinggemma-2', 'local-llm-runtime', 'onnxruntime']);
    expect((await h.set.start()).ok).toBe(true);
    await until(h.set, (s) => s.state === 'ready');
    expect(server.requests.some((r) => r.path.includes('cuda'))).toBe(false);
    expect(log).toContain(
      '[components] local-llm-runtime: local-llm-runtime (local-llm-runtime-cuda: no GPU here offers cuda; local-llm-runtime-vulkan: no GPU here offers vulkan)',
    );
  });

  it('falls to Vulkan on a GPU whose driver is too old for CUDA 13', async () => {
    const old = { ...RTX_4090_HOST.gpus[0]!, driverVersion: '575.57.08' };
    const h = linuxSet({ ...RTX_4090_HOST, gpus: [old] });
    const needed = (await h.set.status()).entries.map((e) => e.status.id).sort();
    expect(needed).toEqual(['embeddinggemma-2', 'local-llm-runtime-vulkan', 'onnxruntime']);
  });
});
