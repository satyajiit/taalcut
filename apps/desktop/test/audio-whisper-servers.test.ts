// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1: the jobs run the whisper-server of the build the ASR plan picks among those installed. On Linux NVIDIA the
 * download set installs `whisper-server-cuda` instead of `whisper-server`; a forced CPU runs that build with `-ng`
 * and says `disabled`; without the CUDA build the CPU build runs and says what wasn't installed.
 */
import { describe, expect, it } from 'vitest';
import { plannedServer, whisperPlan } from '../src/utility/roots/audio-whisper-servers';

const CUDA = '/c/whisper-server-cuda/whisper-server';
const CPU = '/c/whisper-server/whisper-server';
const linux = (builds: Record<string, string>, forcedCpu = false) => ({
  platform: 'linux' as const,
  backends: async () => (forcedCpu ? ['cpu' as const] : (['cuda', 'vulkan', 'cpu'] as const)),
  forcedCpu: async () => forcedCpu,
  builds: async () => new Map(Object.entries(builds)),
});

describe('the planned whisper-server', () => {
  it('runs the CUDA build on Linux NVIDIA', async () => {
    expect(await plannedServer(linux({ 'whisper-server-cuda': CUDA }))).toBe(CUDA);
    const { plan } = await whisperPlan(linux({ 'whisper-server-cuda': CUDA, 'whisper-server': CPU }));
    expect(plan.ok && [plan.value.option.backend, plan.value.fallback]).toEqual(['cuda', undefined]);
  });

  it('runs the CPU build without the CUDA one, and the CUDA build on the CPU when forced', async () => {
    const without = await whisperPlan(linux({ 'whisper-server': CPU }));
    expect(without.plan.ok && without.plan.value.fallback).toMatchObject({
      reason: 'no_accelerator',
      detail: 'not installed: whisper-server-cuda, whisper-server-vulkan',
    });
    expect(await plannedServer(linux({ 'whisper-server': CPU }))).toBe(CPU);

    const forced = await whisperPlan(linux({ 'whisper-server-cuda': CUDA }, true));
    expect(forced.plan.ok && forced.plan.value.option).toMatchObject({
      backend: 'cpu',
      component: 'whisper-server-cuda',
    });
    expect(forced.plan.ok && forced.plan.value.fallback?.reason).toBe('disabled');
    expect(await plannedServer(linux({ 'whisper-server-cuda': CUDA }, true))).toBe(CUDA);
  });

  it('has no server when no build is installed', async () => {
    expect(await plannedServer(linux({}))).toBeUndefined();
  });
});
