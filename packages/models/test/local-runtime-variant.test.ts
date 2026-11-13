// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-TRM: the supervisor installs the runtime as the build the download of everything the machine needs picks
 * (it asks the component manager for the `variant`; packages/jobs' variantHere chooses), never a second copy of
 * the rules. On the RTX 4090 host that is the Vulkan build until NVIDIA's terms are accepted and the CUDA build
 * after, and it launches whichever is installed, CUDA first. The weights install as they are.
 */
import { describe, expect, it } from 'vitest';
import {
  createFakeLocalRuntimeDriver,
  createLocalRuntime,
  createMemoryComponentInstaller,
  llamaCppRuntimeSpec,
  type ComponentInstaller,
  type ComputeBackend,
} from '@taalcut/models';

const LINUX_NVIDIA: readonly ComputeBackend[] = ['cuda', 'vulkan', 'cpu'];

function host(picks: Record<string, string>) {
  const memory = createMemoryComponentInstaller({ variants: picks });
  const asked: (readonly [string, boolean])[] = [];
  const installer: ComponentInstaller = {
    install: (id, options) => {
      asked.push([id, options?.variant === true]);
      return memory.install(id, options);
    },
    get: (id) => memory.get(id),
  };
  const driver = createFakeLocalRuntimeDriver(() => ({
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9/v1',
  }));
  const local = createLocalRuntime({
    spec: llamaCppRuntimeSpec('high'),
    installer,
    driver,
    backends: LINUX_NVIDIA,
    restartDelayMs: () => 0,
  });
  return { memory, asked, driver, local };
}

describe('the runtime build the supervisor installs (LNX1-TRM)', () => {
  it('asks for the variant of the runtime only, and launches the build the download picked', async () => {
    // What packages/jobs' variantHere answers on this host before NVIDIA's terms are accepted.
    const picks = { 'local-llm-runtime': 'local-llm-runtime-vulkan' };
    const { memory, asked, driver, local } = host(picks);
    expect((await local.ensureInstalled('high')).ok).toBe(true);
    expect(asked).toEqual([
      ['local-llm-runtime', true],
      ['local-llm-qwen3-5-4b', false],
      ['local-llm-qwen3-5-4b-mmproj', false],
    ]);
    expect(memory.installed).toEqual([
      'local-llm-runtime-vulkan',
      'local-llm-qwen3-5-4b',
      'local-llm-qwen3-5-4b-mmproj',
    ]);
    expect((await local.start()).ok).toBe(true);
    expect(driver.launches[0]?.runtime.id).toBe('local-llm-runtime-vulkan');
    expect(driver.launches[0]?.runtimes?.map((r) => r.backend)).toEqual(['vulkan']);
    await local.stop();
  });

  it('installs the CUDA build once the terms are accepted, and launches it before the Vulkan one', async () => {
    const picks: Record<string, string> = { 'local-llm-runtime': 'local-llm-runtime-vulkan' };
    const { memory, driver, local } = host(picks);
    await local.ensureInstalled('high');
    picks['local-llm-runtime'] = 'local-llm-runtime-cuda';
    expect((await local.ensureInstalled('high')).ok).toBe(true);
    expect(memory.installed).toContain('local-llm-runtime-cuda');
    expect(memory.installed).not.toContain('local-llm-runtime');
    expect((await local.start()).ok).toBe(true);
    expect(driver.launches[0]?.runtimes?.map((r) => [r.backend, r.files.id])).toEqual([
      ['cuda', 'local-llm-runtime-cuda'],
      ['vulkan', 'local-llm-runtime-vulkan'],
    ]);
    await local.stop();
  });

  it('installs the base where the download picks no other build (a Mac, a machine with no GPU build that fits)', async () => {
    const { memory, driver, local } = host({});
    await local.ensureInstalled('high');
    expect(memory.installed[0]).toBe('local-llm-runtime');
    expect((await local.start()).ok).toBe(true);
    expect(driver.launches[0]?.runtime.id).toBe('local-llm-runtime');
    await local.stop();
  });
});
