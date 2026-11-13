// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- fake backend data (product names, runtimes), never UI copy */

/**
 * Fake compute reports (`system.compute`): where each local module runs on each fake machine (fake-system.ts), and
 * why one fell back to the CPU.
 */
import type { ComputeReport } from '@taalcut/core';
import type { FakeSystem } from './fake-system';

const GB = 1024 ** 3;

export const FAKE_COMPUTE: ComputeReport = {
  gpu: { name: 'Apple M2 Pro', cores: 16, api: 'Metal 3' },
  modules: [
    // @taalcut/models' runtime name (LLAMA_CPP_RUNTIME_NAME).
    { module: 'agent', runtime: 'llama.cpp b11571', backend: 'metal' },
    // The same llama.cpp process as the agent: Qwen3.5 4B reads frames too.
    { module: 'vision', runtime: 'llama.cpp b11571', backend: 'metal' },
    { module: 'embeddings', runtime: 'ONNX Runtime', backend: 'coreml' },
    // A logged CPU fallback, so the screen shows how one looks.
    {
      module: 'speech',
      runtime: 'sherpa-onnx',
      backend: 'cpu',
      fallbackReasonKey: 'compute.fallback.no_gpu_kernels',
    },
  ],
};

/** The RTX 4090 host: CUDA for the language model and speech, WebGPU for embeddings until the CUDA runtime is in. */
export const LINUX_NVIDIA_COMPUTE: ComputeReport = {
  gpu: { name: 'NVIDIA GeForce RTX 4090', api: 'CUDA', vramBytes: 24 * GB, driverVersion: '615.71.09' },
  modules: [
    { module: 'agent', runtime: 'llama.cpp b11571', backend: 'cuda' },
    { module: 'vision', runtime: 'llama.cpp b11571', backend: 'cuda' },
    { module: 'embeddings', runtime: 'ONNX Runtime', backend: 'webgpu' },
    { module: 'speech', runtime: 'whisper.cpp', backend: 'cuda' },
  ],
};

/** The GPU hidden: every local module on the CPU, each with the reason core logged. */
export const LINUX_CPU_COMPUTE: ComputeReport = {
  modules: [
    {
      module: 'embeddings',
      runtime: 'ONNX Runtime',
      backend: 'cpu',
      fallbackReasonKey: 'compute.fallback.no_accelerator',
    },
    {
      module: 'speech',
      runtime: 'whisper.cpp',
      backend: 'cpu',
      fallbackReasonKey: 'compute.fallback.no_accelerator',
    },
  ],
};

/** An NVIDIA GPU CUDA can't use: the language model on Vulkan, embeddings on WebGPU, speech on the CPU. */
const LINUX_NO_CUDA_COMPUTE: ComputeReport = {
  modules: [
    { module: 'agent', runtime: 'llama.cpp b11571', backend: 'vulkan' },
    { module: 'embeddings', runtime: 'ONNX Runtime', backend: 'webgpu' },
    {
      module: 'speech',
      runtime: 'whisper.cpp',
      backend: 'cpu',
      fallbackReasonKey: 'compute.fallback.no_accelerator',
    },
  ],
};

/** A GPU without CUDA that Vulkan reaches (UX3's AMD and Intel machines): the models on Vulkan, embeddings on WebGPU. */
const vulkanCompute = (gpu: NonNullable<ComputeReport['gpu']>): ComputeReport => ({
  gpu,
  modules: [
    { module: 'agent', runtime: 'llama.cpp b11571', backend: 'vulkan' },
    { module: 'vision', runtime: 'llama.cpp b11571', backend: 'vulkan' },
    { module: 'embeddings', runtime: 'ONNX Runtime', backend: 'webgpu' },
    { module: 'speech', runtime: 'whisper.cpp', backend: 'vulkan' },
  ],
});

const COMPUTE: Readonly<Record<FakeSystem, ComputeReport>> = {
  mac: FAKE_COMPUTE,
  'linux-nvidia': LINUX_NVIDIA_COMPUTE,
  'linux-cpu': LINUX_CPU_COMPUTE,
  'linux-nvidia-old-driver': LINUX_NO_CUDA_COMPUTE,
  'linux-nouveau': LINUX_NO_CUDA_COMPUTE,
  'linux-pascal': LINUX_NO_CUDA_COMPUTE,
  'linux-amd': vulkanCompute({ name: 'AMD Radeon RX 7900 XTX', api: 'Vulkan', vramBytes: 24 * GB }),
  'linux-intel': vulkanCompute({ name: 'Intel Arc Graphics', api: 'Vulkan' }),
};

export const fakeCompute = (system: FakeSystem = 'mac'): ComputeReport => COMPUTE[system];
