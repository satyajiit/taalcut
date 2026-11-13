// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-TRM: NVIDIA's CUDA runtime downloads only once the person has accepted NVIDIA's terms in the app. Until then
 * it, and every build that loads it, stays out of the download of everything the RTX 4090 host needs, each variant
 * group falling back to the next build that runs without it (Vulkan for llama.cpp, the WebGPU and CPU build for ONNX
 * Runtime), with the reason logged; an install asked for anyway is refused before a byte is fetched; and a new
 * terms version asks again. The ids and requirements mirror tools/components.
 */
import { rm } from 'node:fs/promises';
import { componentTermsFeatureId, ok, type AsyncResult } from '@taalcut/core';
import type { MachineDescription, TermsBook } from '@taalcut/jobs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DeterministicContent } from './helpers/content';
import { manifestOf, OpenedInTest, tempDir, type FileComponentSpec } from './helpers/fixtures';
import { TestServer } from './helpers/server';
import { KiB, makeSet, until, type SetHarness } from './helpers/set-fixtures';

const CUDA_13 = { gpuApi: 'cuda', minDriver: '580', minComputeCapability: '7.5' };
const NVIDIA = {
  owner: 'NVIDIA Corporation',
  termsVersion: '2026-10-27',
  documents: [
    { title: 'CUDA Toolkit End User License Agreement', url: 'https://docs.nvidia.com/cuda/eula/index.html' },
  ],
};
const FILES = {
  onnxruntime: new DeterministicContent(64 * KiB, 't-ort'),
  'onnxruntime-cuda': new DeterministicContent(256 * KiB, 't-ort-cuda'),
  'cuda-runtime-13': new DeterministicContent(512 * KiB, 't-cuda'),
  'whisper-server': new DeterministicContent(16 * KiB, 't-whisper'),
  'whisper-server-cuda': new DeterministicContent(80 * KiB, 't-whisper-cuda'),
  'local-llm-runtime': new DeterministicContent(32 * KiB, 't-llama'),
  'local-llm-runtime-cuda': new DeterministicContent(128 * KiB, 't-llama-cuda'),
  'local-llm-runtime-vulkan': new DeterministicContent(48 * KiB, 't-llama-vk'),
  'embeddinggemma-2': new DeterministicContent(96 * KiB, 't-gemma'),
} as const;
type Id = keyof typeof FILES;
const CUDA_BUILD = { requires: CUDA_13, dependencies: ['cuda-runtime-13'] };
const EXTRA: Partial<Record<Id, Partial<FileComponentSpec>>> = {
  onnxruntime: { tiers: ['high'], variants: ['onnxruntime-cuda'] },
  'onnxruntime-cuda': CUDA_BUILD,
  'cuda-runtime-13': { requires: CUDA_13, acceptance: NVIDIA },
  'whisper-server': { tiers: ['high'], variants: ['whisper-server-cuda'] },
  'whisper-server-cuda': CUDA_BUILD,
  'local-llm-runtime': { tiers: ['high'], variants: ['local-llm-runtime-cuda', 'local-llm-runtime-vulkan'] },
  'local-llm-runtime-cuda': CUDA_BUILD,
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

/** The library's acknowledgements, as the jobs process reads them: exactly this featureId and version. */
function acknowledgements(...accepted: (readonly [string, string])[]): TermsBook & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    has: async (featureId, termsVersion): AsyncResult<boolean> => {
      asked.push(`${featureId}@${termsVersion}`);
      return ok(accepted.some(([f, v]) => f === featureId && v === termsVersion));
    },
  };
}
const ACCEPTED = [componentTermsFeatureId('cuda-runtime-13'), NVIDIA.termsVersion] as const;

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
  root = await tempDir('taalcut-terms-');
  server.requests.length = 0;
});
afterEach(async () => {
  await opened.closeAll();
  server.release();
  await rm(root, { recursive: true, force: true });
});

function hostSet(terms: TermsBook | undefined, log: string[] = [], acceptance = NVIDIA): SetHarness {
  const manifest = manifestOf(
    ...Object.entries(FILES).map(([id, content]) => ({
      id,
      urls: [server.url(`/${id}`)],
      size: content.size,
      sha256: content.sha256(),
      platform: 'linux-x64',
      ...EXTRA[id as Id],
      ...(id === 'cuda-runtime-13' ? { acceptance } : {}),
    })),
  );
  return opened.add(
    makeSet(root, manifest, {
      platform: 'linux-x64',
      machine: async () => ok({ tier: 'high', machine: RTX_4090_HOST }),
      log: (message) => log.push(message),
      ...(terms ? { terms } : {}),
    }),
  );
}

const ids = (status: Awaited<ReturnType<SetHarness['set']['status']>>) =>
  status.entries.map((entry) => entry.status.id).sort();

describe("NVIDIA's terms not accepted", () => {
  it('leaves the CUDA runtime and every build that loads it out, each group on its next GPU build', async () => {
    const log: string[] = [];
    const h = hostSet(acknowledgements(), log);
    const status = await h.set.status();
    expect(ids(status)).toEqual([
      'embeddinggemma-2',
      'local-llm-runtime-vulkan',
      'onnxruntime',
      'whisper-server',
    ]);
    expect(status.awaitingTerms.map((each) => [each.status.id, [...each.unlocks].sort()])).toEqual([
      ['cuda-runtime-13', ['local-llm-runtime-cuda', 'onnxruntime-cuda', 'whisper-server-cuda']],
    ]);
    expect(status.awaitingTerms[0]?.status.licence.acceptance?.owner).toBe('NVIDIA Corporation');
    expect((await h.set.start()).ok).toBe(true);
    await until(h.set, (s) => s.state === 'ready');
    expect(server.requests.some((request) => request.path.includes('cuda'))).toBe(false);
    const reason = "NVIDIA Corporation's terms not accepted (cuda-runtime-13)";
    expect(log).toContain(
      `[components] local-llm-runtime: local-llm-runtime-vulkan (local-llm-runtime-cuda: ${reason})`,
    );
    expect(log).toContain(`[components] onnxruntime: onnxruntime (onnxruntime-cuda: ${reason})`);
    expect(log).toContain(`[components] whisper-server: whisper-server (whisper-server-cuda: ${reason})`);
  });

  it('fails closed without a store to read, or one that cannot answer', async () => {
    expect(ids(await hostSet(undefined).set.status())).not.toContain('cuda-runtime-13');
    const broken: TermsBook = {
      has: async () => {
        throw new Error('library closed');
      },
    };
    const log: string[] = [];
    const h = hostSet(broken, log);
    expect((await h.set.status()).awaitingTerms.map((each) => each.status.id)).toEqual(['cuda-runtime-13']);
    expect((await h.set.start()).ok).toBe(true);
    expect(log).toContain("[components] cuda-runtime-13: its terms can't be read; treated as not accepted");
  });

  it('refuses an install asked for anyway, before a byte is fetched, without keeping it as a failure', async () => {
    const h = hostSet(acknowledgements());
    for (const id of ['cuda-runtime-13', 'onnxruntime-cuda']) {
      const installed = await h.manager.install(id);
      expect(!installed.ok && installed.error).toMatchObject({
        code: 'jobs.terms_not_accepted',
        params: { component: 'cuda-runtime-13', owner: 'NVIDIA Corporation' },
      });
    }
    expect(server.requests).toEqual([]);
    const rows = await h.manager.list();
    expect(rows.find((row) => row.id === 'onnxruntime-cuda')?.lastError).toBeUndefined();
  });

  it('picks the same build for an install that asks for the one that runs here', async () => {
    const h = hostSet(acknowledgements());
    expect(await h.set.variantOf('local-llm-runtime')).toEqual(ok('local-llm-runtime-vulkan'));
    expect(await h.set.variantOf('whisper-server')).toEqual(ok('whisper-server'));
    expect(await h.set.variantOf('embeddinggemma-2')).toEqual(ok('embeddinggemma-2'));
    const unknown = await h.set.variantOf('nope');
    expect(!unknown.ok && unknown.error.code).toBe('jobs.component_unknown');
  });
});

describe("NVIDIA's terms accepted", () => {
  it('brings the CUDA builds and the runtime in, and installs them, checksummed', async () => {
    const book = acknowledgements(ACCEPTED);
    const h = hostSet(book);
    const status = await h.set.status();
    expect(status.awaitingTerms).toEqual([]);
    expect(ids(status)).toEqual([
      'cuda-runtime-13',
      'embeddinggemma-2',
      'local-llm-runtime-cuda',
      'onnxruntime',
      'onnxruntime-cuda',
      'whisper-server-cuda',
    ]);
    expect(await h.set.variantOf('local-llm-runtime')).toEqual(ok('local-llm-runtime-cuda'));
    expect((await h.set.start()).ok).toBe(true);
    await until(h.set, (s) => s.state === 'ready');
    expect((await h.manager.get('cuda-runtime-13'))?.sha256).toBe(FILES['cuda-runtime-13'].sha256());
    expect(book.asked).toContain('component.terms:cuda-runtime-13@2026-10-27');
  });

  it('re-plans when the person accepts after the set started on the builds that run without it', async () => {
    const accepted: (readonly [string, string])[] = [];
    const book: TermsBook = {
      has: async (f, v) => ok(accepted.some(([a, b]) => a === f && b === v)),
    };
    const h = hostSet(book);
    expect((await h.set.start()).ok).toBe(true);
    await until(h.set, (s) => s.state === 'ready');
    expect(ids(await h.set.status())).not.toContain('cuda-runtime-13');
    accepted.push(ACCEPTED);
    const after = await h.set.status();
    expect(after.state).toBe('missing');
    expect(ids(after)).toContain('onnxruntime-cuda');
    expect((await h.set.start()).ok).toBe(true);
    await until(h.set, (s) => s.state === 'ready');
    expect(await h.manager.get('whisper-server-cuda')).toBeDefined();
  });

  it('asks again for a new terms version: an acceptance of the old one no longer counts', async () => {
    const h = hostSet(acknowledgements(ACCEPTED), [], { ...NVIDIA, termsVersion: '2027-01-15' });
    const status = await h.set.status();
    expect(status.awaitingTerms.map((each) => each.status.id)).toEqual(['cuda-runtime-13']);
    expect(ids(status)).not.toContain('onnxruntime-cuda');
    const installed = await h.manager.install('cuda-runtime-13');
    expect(!installed.ok && installed.error.code).toBe('jobs.terms_not_accepted');
  });
});
