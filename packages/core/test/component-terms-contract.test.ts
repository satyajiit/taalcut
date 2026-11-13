// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-TRM: a component whose owner licenses it to the person under terms they accept in the app (NVIDIA's CUDA
 * runtime). Its terms travel with its row, the download says what waits on them, the acceptance is an
 * acknowledgement under the component's own featureId, and an install can ask for the build that runs here.
 */
import { describe, expect, it } from 'vitest';
import {
  acknowledgementsContract,
  componentInstallerContract,
  componentInstallerOverRpc,
  componentInstallerRouter,
  componentSchema,
  componentTermsFeatureId,
  connectRpc,
  downloadsSchema,
  ok,
  serveRpc,
  type Component,
  type ComponentInstallOptions,
  type ComponentsPort,
  type Downloads,
} from '@taalcut/core';
import type { z } from 'zod';
import { channel } from './helpers/ports';

const NVIDIA_TERMS = {
  owner: 'NVIDIA Corporation',
  termsVersion: '2026-10-27',
  documents: [
    { title: 'CUDA Toolkit End User License Agreement', url: 'https://docs.nvidia.com/cuda/eula/index.html' },
  ],
  accepted: false,
};

const cudaRuntime: Component = {
  id: 'cuda-runtime-13',
  name: 'CUDA runtime 13',
  version: '13.4.3-cudnn9.27.0',
  licence: 'LicenseRef-NVIDIA-CUDA-Toolkit-EULA AND LicenseRef-NVIDIA-cuDNN',
  sizeBytes: 968_041_808,
  status: 'not-installed',
  usedBy: [],
  job: 'search',
  terms: NVIDIA_TERMS,
};

const nothing: Downloads = {
  state: 'ready',
  components: [],
  counts: { installed: 0, downloading: 0, queued: 0, paused: 0, failed: 0, missing: 0 },
  bytesTotal: 0,
  bytesDone: 0,
  bytesPerSecond: 0,
  requiredBytes: 0,
};

describe("a component under its owner's terms", () => {
  it('carries the owner, the terms version, each document and whether they were accepted', () => {
    expect(componentSchema.parse(cudaRuntime).terms).toEqual(NVIDIA_TERMS);
    const plainHttp = { ...NVIDIA_TERMS, documents: [{ title: 'EULA', url: 'http://example.com/eula' }] };
    expect(componentSchema.safeParse({ ...cudaRuntime, terms: plainHttp }).success).toBe(false);
    expect(
      componentSchema.safeParse({ ...cudaRuntime, terms: { ...NVIDIA_TERMS, documents: [] } }).success,
    ).toBe(false);
    const { terms: _none, ...plain } = cudaRuntime;
    expect(componentSchema.parse(plain)).not.toHaveProperty('terms');
  });

  it('is held out of the download with what it brings in, until they are accepted', () => {
    const held = downloadsSchema.parse({
      ...nothing,
      awaitingTerms: [{ component: cudaRuntime, unlocks: ['onnxruntime-cuda', 'whisper-server-cuda'] }],
    });
    expect(held.awaitingTerms?.[0]).toMatchObject({
      component: { id: 'cuda-runtime-13', terms: { owner: 'NVIDIA Corporation' } },
      unlocks: ['onnxruntime-cuda', 'whisper-server-cuda'],
    });
    expect(downloadsSchema.parse(nothing)).not.toHaveProperty('awaitingTerms');
  });

  it("is accepted as an acknowledgement under the component's own featureId", () => {
    const featureId = componentTermsFeatureId('cuda-runtime-13');
    expect(featureId).toBe('component.terms:cuda-runtime-13');
    const record = acknowledgementsContract.record['~orpc'].inputSchema as z.ZodType;
    expect(
      record.safeParse({
        featureId,
        termsVersion: NVIDIA_TERMS.termsVersion,
        context: { component: 'cuda-runtime-13', version: '13.4.3-cudnn9.27.0' },
      }).success,
    ).toBe(true);
    // The longest component id the manifest allows (64) still fits the acknowledgement's featureId (100).
    expect(componentTermsFeatureId('a'.repeat(64)).length).toBeLessThanOrEqual(100);
  });
});

describe('an install that asks for the build that runs here', () => {
  it('passes `variant` across the port, and leaves a plain install as it was', async () => {
    const asked: { id: string; options: ComponentInstallOptions | undefined }[] = [];
    const port: ComponentsPort = {
      async install(id, options) {
        asked.push({ id, options: options?.variant ? { variant: true } : undefined });
        const built = options?.variant ? `${id}-vulkan` : id;
        return ok({ id: built, version: 'b1', path: `/c/${built}`, notice: `/c/${built}/NOTICE.txt` });
      },
      get: async () => undefined,
      list: async () => [],
      downloads: async () => nothing,
      startDownloads: async () => ok(nothing),
      pauseDownloads: async () => nothing,
      cancelDownloads: async () => nothing,
    };
    const { port1, port2 } = channel();
    serveRpc(componentInstallerRouter(port), port1, { context: {}, exposeDetail: true });
    const client = connectRpc(componentInstallerContract, port2, { peer: 'jobs' }).client;
    const remote = componentInstallerOverRpc(() => client);
    expect(await remote.install('local-llm-runtime', { variant: true })).toMatchObject({
      ok: true,
      value: { id: 'local-llm-runtime-vulkan' },
    });
    expect(await remote.install('local-llm-runtime')).toMatchObject({
      ok: true,
      value: { id: 'local-llm-runtime' },
    });
    expect(asked).toEqual([
      { id: 'local-llm-runtime', options: { variant: true } },
      { id: 'local-llm-runtime', options: undefined },
    ]);
  });
});
