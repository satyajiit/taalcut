// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Where whisper and Parakeet run, per machine (IX-A6), from fake hardware profiles: only the Mac rows have run. */
import type { ComputeBackend } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { planAsrBackend, type AsrMachine } from '../../src/speech/asr-backends';

const appleSilicon: AsrMachine = { platform: 'darwin', backends: ['metal', 'mlx', 'coreml', 'ane', 'cpu'] };
const intelMac: AsrMachine = { platform: 'darwin', backends: ['coreml', 'cpu'] };
const nvidiaPc = (installed?: (component: string) => boolean): AsrMachine => ({
  platform: 'win32',
  backends: ['cuda', 'directml', 'vulkan', 'cpu'],
  ...(installed ? { installed } : {}),
});
const amdPc: AsrMachine = { platform: 'win32', backends: ['directml', 'vulkan', 'cpu'] };

function chosen(engine: 'whisper' | 'parakeet', machine: AsrMachine) {
  const plan = planAsrBackend(engine, machine);
  if (!plan.ok) throw new Error(plan.error.code);
  return plan.value;
}

describe('ASR backend plans', () => {
  it('runs whisper on Metal and Parakeet on the Neural Engine on Apple silicon', () => {
    expect(chosen('whisper', appleSilicon)).toEqual({
      engine: 'whisper',
      option: { backend: 'metal', runtime: 'whisper.cpp', component: 'whisper-server', cli: 'whisper-cpp' },
    });
    expect(chosen('parakeet', appleSilicon).option).toEqual({
      backend: 'ane',
      runtime: 'fluidaudio',
      component: 'parakeet-tdt-0-6b-v3-coreml',
    });
  });

  it('runs the same whisper build on the CPU on an Intel Mac, and says why', () => {
    const whisper = chosen('whisper', intelMac);
    expect(whisper.option).toMatchObject({ backend: 'cpu', component: 'whisper-server' });
    expect(whisper.fallback).toEqual({
      operation: 'audio.whisper',
      wanted: ['metal'],
      reason: 'no_accelerator',
      detail: 'no metal on this machine',
    });
    expect(chosen('parakeet', intelMac)).toMatchObject({
      option: { backend: 'cpu', runtime: 'sherpa-onnx', provider: 'cpu' },
      fallback: { operation: 'audio.transcribe', wanted: ['ane'] },
    });
  });

  it('prefers CUDA on an NVIDIA PC, for whisper.cpp and for sherpa-onnx', () => {
    expect(chosen('whisper', nvidiaPc()).option).toMatchObject({
      backend: 'cuda',
      component: 'whisper-server-cuda',
      cli: 'whisper-cpp-cuda',
    });
    expect(chosen('parakeet', nvidiaPc()).option).toMatchObject({ backend: 'cuda', provider: 'cuda' });
  });

  it('takes the next GPU build when the first is not installed, before the CPU', () => {
    const noCuda = (component: string) => component !== 'whisper-server-cuda';
    const plan = chosen('whisper', nvidiaPc(noCuda));
    expect(plan.option.backend).toBe('vulkan');
    expect(plan.fallback).toBeUndefined();
  });

  it('runs whisper on Vulkan and Parakeet on DirectML on an AMD PC', () => {
    expect(chosen('whisper', amdPc).option.backend).toBe('vulkan');
    expect(chosen('parakeet', amdPc).option).toMatchObject({ backend: 'directml', provider: 'directml' });
  });

  it('names the builds that are missing when it comes to the CPU', () => {
    const cpuOnly = (component: string) => component === 'whisper-server';
    const plan = chosen('whisper', nvidiaPc(cpuOnly));
    expect(plan.option).toMatchObject({ backend: 'cpu', component: 'whisper-server', cli: 'whisper-cpp' });
    expect(plan.fallback?.detail).toBe('not installed: whisper-server-cuda, whisper-server-vulkan');
  });

  it('runs CUDA on a Linux NVIDIA PC, and takes the CPU build when the CUDA build is not installed', () => {
    const linux = (installed: string[], extra: Partial<AsrMachine> = {}): AsrMachine => ({
      platform: 'linux',
      backends: ['cuda', 'vulkan', 'cpu'],
      installed: (component) => installed.includes(component),
      ...extra,
    });
    expect(chosen('whisper', linux(['whisper-server-cuda'])).option).toMatchObject({
      backend: 'cuda',
      component: 'whisper-server-cuda',
    });
    const cpu = chosen('whisper', linux(['whisper-server']));
    expect(cpu.option).toMatchObject({ backend: 'cpu', component: 'whisper-server' });
    expect(cpu.fallback).toMatchObject({
      reason: 'no_accelerator',
      wanted: ['cuda', 'vulkan'],
      detail: 'not installed: whisper-server-cuda, whisper-server-vulkan',
    });
    // TAALCUT_FORCE_CPU: the CPU as `disabled`; only the CUDA build is installed (the variant), so it runs `-ng`.
    const forced = chosen('whisper', linux(['whisper-server-cuda'], { backends: ['cpu'], forcedCpu: true }));
    expect(forced.option).toMatchObject({ backend: 'cpu', component: 'whisper-server-cuda' });
    expect(forced.fallback).toEqual({
      operation: 'audio.whisper',
      wanted: ['cuda', 'vulkan'],
      reason: 'disabled',
      detail: 'TAALCUT_FORCE_CPU turned the GPUs off',
    });
  });

  it('fails when not even the CPU build is installed', () => {
    const backends: ComputeBackend[] = ['cpu'];
    const plan = planAsrBackend('whisper', { platform: 'linux', backends, installed: () => false });
    expect(!plan.ok && plan.error.code).toBe('core.compute_unavailable');
  });
});
