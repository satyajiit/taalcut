// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Where speech recognition runs on this machine (IX-A6, ADR 0002 GPU first): each engine's backends in order of
 * preference, each with the component that carries a build for it. The hardware profile says which backends
 * the machine has (`@taalcut/models` availableBackends: Metal on Apple GPUs, CUDA, DirectML, Vulkan), the
 * component manager which builds are installed, and `selectBackend` takes the first both offer; the CPU only
 * when none does, as a `compute.fallback` the caller emits once.
 *
 * - whisper.cpp: Metal (the macOS build, `tools/whisper/build.sh`), CUDA (`-DGGML_CUDA=1`, `whisper-server-cuda`,
 *   built for CUDA 13), Vulkan (`-DGGML_VULKAN=1`, AMD and Intel GPUs on Windows and Linux), else the CPU (`-ng`).
 *   The CPU build is `whisper-server` itself: on macOS the Metal build told `-ng`, on Linux the base component's
 *   linux-x64 artifact. Where only a GPU build is installed (the download set installs the variant instead of the
 *   base), that build runs the CPU with `-ng`. Sources: whisper.cpp README, "NVIDIA GPU support" and "Vulkan GPU
 *   support" (github.com/ggml-org/whisper.cpp, v1.9.5).
 * - Parakeet TDT 0.6B v3: Core ML on the Neural Engine through FluidAudio (the mac helper), else the int8 ONNX
 *   export through sherpa-onnx with ONNX Runtime's CUDA or DirectML execution provider (`provider: 'cuda'` /
 *   `'directml'`), else its CPU provider. Sources: FluidAudio README (github.com/FluidInference/FluidAudio,
 *   0.17.7); sherpa-onnx docs, "Install / GPU" and the `provider` option (k2-fsa.github.io/sherpa/onnx);
 *   ONNX Runtime execution providers (onnxruntime.ai/docs/execution-providers).
 * The macOS rows and Linux's CUDA and CPU rows have run (SPEC, Windows and Linux); the rest is the plan the Windows
 * build follows. TAALCUT_FORCE_CPU (`forcedCpu`) gives the CPU with the reason `disabled`.
 */
import {
  ComputeUnavailable,
  computeFallbackEvent,
  err,
  ok,
  selectBackend,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type Result,
} from '@taalcut/core';

export type AsrEngine = 'whisper' | 'parakeet';

export interface AsrBackendOption {
  readonly backend: ComputeBackend;
  readonly runtime: 'whisper.cpp' | 'fluidaudio' | 'sherpa-onnx';
  /** The component holding the build (for whisper.cpp, the persistent server; `cli` is the per-call one). */
  readonly component: string;
  readonly cli?: string;
  /** sherpa-onnx's `provider`. */
  readonly provider?: 'cuda' | 'directml' | 'cpu';
}

export const ASR_BACKENDS: Readonly<Record<AsrEngine, readonly AsrBackendOption[]>> = {
  whisper: [
    { backend: 'metal', runtime: 'whisper.cpp', component: 'whisper-server', cli: 'whisper-cpp' },
    { backend: 'cuda', runtime: 'whisper.cpp', component: 'whisper-server-cuda', cli: 'whisper-cpp-cuda' },
    {
      backend: 'vulkan',
      runtime: 'whisper.cpp',
      component: 'whisper-server-vulkan',
      cli: 'whisper-cpp-vulkan',
    },
    { backend: 'cpu', runtime: 'whisper.cpp', component: 'whisper-server', cli: 'whisper-cpp' },
  ],
  parakeet: [
    { backend: 'ane', runtime: 'fluidaudio', component: 'parakeet-tdt-0-6b-v3-coreml' },
    { backend: 'cuda', runtime: 'sherpa-onnx', component: 'parakeet-tdt-0-6b-v3', provider: 'cuda' },
    { backend: 'directml', runtime: 'sherpa-onnx', component: 'parakeet-tdt-0-6b-v3', provider: 'directml' },
    { backend: 'cpu', runtime: 'sherpa-onnx', component: 'parakeet-tdt-0-6b-v3', provider: 'cpu' },
  ],
};

export interface AsrMachine {
  /** The hardware profile's backends (`assessment.compute.backends`). */
  readonly backends: readonly ComputeBackend[];
  readonly platform: NodeJS.Platform;
  /** Whether a component is installed. Absent: every one is (the plan alone). */
  readonly installed?: (component: string) => boolean;
  /** TAALCUT_FORCE_CPU turned the GPUs off (the probe's `forcedCpu`): the CPU, as `disabled`. */
  readonly forcedCpu?: boolean;
}

export interface AsrBackendPlan {
  readonly engine: AsrEngine;
  readonly option: AsrBackendOption;
  /** The CPU was chosen: emit this once. */
  readonly fallback?: ComputeFallbackEvent;
}

/** The rows that exist for this OS: Metal and the Neural Engine on macOS, CUDA, DirectML and Vulkan elsewhere. */
function optionsFor(engine: AsrEngine, platform: NodeJS.Platform): readonly AsrBackendOption[] {
  const rows = ASR_BACKENDS[engine];
  if (platform === 'darwin')
    return rows.filter((row) => row.backend === 'metal' || row.backend === 'ane' || row.backend === 'cpu');
  return rows.filter(
    (row) =>
      row.backend !== 'metal' &&
      row.backend !== 'ane' &&
      (row.backend !== 'directml' || platform === 'win32'),
  );
}

/** whisper.cpp's CPU row: its own build, else an installed GPU build told `-ng`. */
function cpuBuild(
  engine: AsrEngine,
  options: readonly AsrBackendOption[],
  installed: (component: string) => boolean,
): AsrBackendOption | undefined {
  const own = options.find((option) => option.backend === 'cpu');
  if (!own || installed(own.component) || engine !== 'whisper') return own;
  const gpu = options.find((option) => option.backend !== 'cpu' && installed(option.component));
  return gpu ? { ...gpu, backend: 'cpu' } : own;
}

export function planAsrBackend(engine: AsrEngine, machine: AsrMachine): Result<AsrBackendPlan> {
  const isInstalled = machine.installed ?? (() => true);
  const rows = optionsFor(engine, machine.platform);
  const cpu = cpuBuild(engine, rows, isInstalled);
  const options = rows.map((option) => (option.backend === 'cpu' && cpu ? cpu : option));
  const offered = new Set(machine.forcedCpu ? [] : machine.backends);
  const usable = (option: AsrBackendOption) =>
    (offered.has(option.backend) || option.backend === 'cpu') && isInstalled(option.component);
  const candidates = options.map((option) => option.backend);
  const missing = options.filter((option) => option.backend !== 'cpu' && offered.has(option.backend));
  const detail = machine.forcedCpu
    ? 'TAALCUT_FORCE_CPU turned the GPUs off'
    : missing.length > 0
      ? `not installed: ${missing.map((option) => option.component).join(', ')}`
      : `no ${candidates.filter((backend) => backend !== 'cpu').join('/')} on this machine`;
  const chosen = selectBackend(
    candidates,
    (backend) => options.some((option) => option.backend === backend && usable(option)),
    { detail, ...(machine.forcedCpu ? { fallbackReason: 'disabled' as const } : {}) },
  );
  if (!chosen.ok) return chosen;
  const option = options.find((candidate) => candidate.backend === chosen.value.backend);
  if (!option || !usable(option))
    return err(
      ComputeUnavailable(
        { candidates: candidates.join(', ') },
        { detail: `${engine}: the CPU build is not installed` },
      ),
    );
  const operation = engine === 'whisper' ? 'audio.whisper' : 'audio.transcribe';
  return ok({
    engine,
    option,
    ...(chosen.value.fallback
      ? { fallback: computeFallbackEvent(operation, candidates, chosen.value.fallback) }
      : {}),
  });
}
