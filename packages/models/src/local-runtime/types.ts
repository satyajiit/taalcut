// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The embedded local language-model runtime (decision D16: nothing for the
 * user to install). The runtime and its tier-specific model files are
 * components the app downloads through packages/jobs' component manager; the
 * app starts and supervises the runtime, which serves either an
 * OpenAI-compatible base URL pi-ai calls, or an in-process ModelClient adapter.
 * Spike 08 (P1-J8, provisional) picked a llama.cpp `llama-server` sidecar
 * (llama-server.ts); MLX1 added Taalcut's own MLX server for Apple silicon
 * (native/mlx-server, mlx-server.ts), which serves the same OpenAI-compatible
 * `/v1`. Each model names the engine that serves it; one process serves one
 * model at a time.
 */
import type { AsyncResult, TaalcutError } from '@taalcut/core';
import type { ModelClient } from '../client/types';
import type { ComputeBackend, ComputeChoice } from '../hardware/compute';
import type { HardwareTier } from '../hardware/types';

/** Provider id of the embedded runtime in profiles and the cloud-call log. */
export const LOCAL_RUNTIME_PROVIDER = 'on-device';

/**
 * The server that runs a model: llama.cpp's `llama-server` (GGUF weights, every platform) or taalcut-mlx-server
 * (MLX weights, Apple silicon; MLX1).
 */
export type LocalEngine = 'llama.cpp' | 'mlx';

export interface LocalRuntimeModel {
  /** Model id under LOCAL_RUNTIME_PROVIDER, e.g. 'qwen3.5-4b'. */
  readonly id: string;
  /** Product name for the model picker, e.g. 'Qwen3.5 4B'. */
  readonly name?: string;
  /** Manifest component that holds the weights. */
  readonly componentId: string;
  /** Manifest component of the vision projector (llama.cpp's mmproj), when vision needs one. */
  readonly projectorComponentId?: string;
  /** Smallest tier that gets these weights by default, and the memory guard's floor. */
  readonly minTier: HardwareTier;
  /**
   * Largest tier that downloads these weights by default, when a bigger tier
   * gets a bigger model instead (the 0.8B stops at Minimum). Unset: every tier
   * from minTier up.
   */
  readonly maxTier?: HardwareTier;
  readonly vision: boolean;
  readonly reasoning: boolean;
  readonly contextWindow: number;
  readonly maxTokens?: number;
  /**
   * The chat-template switch for thinking, e.g. 'enable_thinking' for Qwen3.5:
   * sent in `chat_template_kwargs` on every call, false when reasoning is 'off'.
   */
  readonly thinkingKwarg?: string;
  /**
   * The chat template the runtime renders this model's requests with, when not the one in its weights (llama.cpp's
   * `--chat-template`; LRN1-CTX: the model's own with the tools written compact, `chat-templates/`).
   */
  readonly chatTemplate?: string;
  /** Backends the runtime can run this model on, accelerated first (ADR 0002). */
  readonly compute: readonly ComputeBackend[];
  /** The server that runs it. Default 'llama.cpp'. */
  readonly engine?: LocalEngine;
  /**
   * Manifest component of the server that runs it, when not the spec's `runtimeComponentId` (the MLX server). The
   * weights count as installed only with it.
   */
  readonly runtimeComponentId?: string;
  /**
   * AGT1: llama-server's host prompt cache, in MiB (`--cache-ram`; 0 turns it off). It keeps the agent's prompt
   * across a vision call on the one slot. Unset: off.
   */
  readonly hostCacheMiB?: number;
}

/** The engine that serves `model`. */
export const engineOf = (model: Pick<LocalRuntimeModel, 'engine'>): LocalEngine =>
  model.engine ?? 'llama.cpp';

export interface LocalRuntimeSpec {
  /** Shown in Settings → About, e.g. 'llama.cpp b6000'. */
  readonly name: string;
  /**
   * Manifest component of the runtime itself (binary or library): Metal on macOS, the CPU elsewhere. `ensureInstalled`
   * installs it as `variant`, so it gets the build the download set picks here.
   */
  readonly runtimeComponentId: string;
  /**
   * The runtime's GPU builds, by the backend each runs (LNX1): on Linux the download set installs
   * `local-llm-runtime-cuda` (when CUDA fits and NVIDIA's terms are accepted) or `-vulkan` instead of the base. Each
   * also runs the CPU.
   */
  readonly runtimeBuilds?: Readonly<Partial<Record<ComputeBackend, string>>>;
  readonly models: readonly LocalRuntimeModel[];
}

export type LocalRuntimeEndpoint =
  /** A loopback HTTP server speaking Chat Completions; registered as a LocalEndpoint. */
  | {
      readonly kind: 'openai-compatible';
      readonly baseUrl: string;
      /** A per-launch key the server requires, so other local processes and web pages can't use it. */
      readonly apiKey?: string;
      /** Model ids it serves. Default: every installed model. */
      readonly models?: readonly string[];
    }
  /** An in-process runtime with no HTTP server (e.g. a native bridge); ModelClient delegates to it. */
  | { readonly kind: 'adapter'; readonly client: ModelClient };

export type LocalRuntimeState =
  | 'not_installed'
  | 'installing'
  | 'installed'
  | 'starting'
  | 'running'
  | 'stopping'
  | 'crashed'
  | 'failed'
  /** Stopped to free memory for an export (LocalRuntimeManager.stopForExport). */
  | 'paused';

export interface LocalRuntimeStatus {
  readonly state: LocalRuntimeState;
  /** Model ids whose weights are installed. */
  readonly installedModels: readonly string[];
  /** Restarts after unexpected exits since the last start(). */
  readonly restarts: number;
  readonly error?: TaalcutError;
}

export interface LoadedLocalModel {
  readonly id: string;
  /** Where it actually runs now, as the runtime reports it. */
  readonly compute: ComputeChoice;
  readonly memoryBytes?: number;
}

/**
 * What the runtime needs from packages/jobs' component manager: core's ComponentInstallerPort (the agent process's
 * componentInstallerOverRpc) satisfies it as is.
 */
export interface ComponentInstaller {
  /**
   * Installs with dependencies, or does nothing when the manifest version is installed. `variant` (LNX1-TRM): the
   * member of `id`'s variant group the download of everything the machine needs takes here instead, by the same
   * selection (an accelerator build that fits and whose owner's terms are accepted, else the next, else `id`).
   */
  install(
    id: string,
    options?: { readonly signal?: AbortSignal; readonly variant?: boolean },
  ): AsyncResult<InstalledComponentRef>;
  get(id: string): Promise<InstalledComponentRef | undefined>;
}

export interface InstalledComponentRef {
  readonly id: string;
  readonly version: string;
  /** Absolute path of the component's folder. */
  readonly path: string;
  /** Absolute path of the file, for single-file components. */
  readonly file?: string;
}

export interface LaunchModel {
  readonly model: LocalRuntimeModel;
  readonly files: InstalledComponentRef;
  /** Set when the model has a projector component. */
  readonly projector?: InstalledComponentRef;
}

/** An installed build of the runtime: a GPU build with its backend, or the base (Metal on macOS, the CPU). */
export interface LaunchRuntime {
  /** The GPU build's backend; undefined for the base build. */
  readonly backend?: ComputeBackend;
  readonly files: InstalledComponentRef;
}

/** The GPU the runtime sizes itself for (the probe's CUDA device and its free video memory). */
export interface LaunchGpu {
  /** CUDA's ordinal for it, after CUDA_VISIBLE_DEVICES (llama.cpp's `CUDA<n>`). */
  readonly cudaDeviceId?: number;
  /** Video memory it can plan on; absent with unified memory. */
  readonly vramBytes?: number;
  /** Its name and whole video memory, to find it among the Vulkan build's devices (vulkan-device.ts). */
  readonly name?: string;
  readonly totalVramBytes?: number;
}

export interface LaunchInput {
  /** The first of `runtimes`. */
  readonly runtime: InstalledComponentRef;
  /** Every installed build: the GPU builds in this machine's backend order, then the base. Default: `runtime`. */
  readonly runtimes?: readonly LaunchRuntime[];
  /** Installed models this tier may load, in spec order (preferred first). */
  readonly models: readonly LaunchModel[];
  /** This machine's backends, accelerated first: the driver must try them in this order. */
  readonly backends: readonly ComputeBackend[];
  readonly gpu?: LaunchGpu;
  /** TAALCUT_FORCE_CPU: the CPU, and its reason `disabled`. */
  readonly forcedCpu?: boolean;
  readonly signal: AbortSignal;
}

/** The runtime-specific part: createLlamaServerDriver since spike 08. */
export interface LocalRuntimeDriver {
  /** Starts the runtime; resolves once it accepts requests. */
  launch(input: LaunchInput): Promise<RunningLocalRuntime>;
}

export interface RunningLocalRuntime {
  readonly endpoint: LocalRuntimeEndpoint;
  /** Settles when the runtime exits, whether stopped or crashed. */
  readonly exited: Promise<{ readonly code: number | null; readonly reason?: string }>;
  stop(): Promise<void>;
  loadedModels(): Promise<
    readonly { readonly id: string; readonly backend: ComputeBackend; readonly memoryBytes?: number }[]
  >;
}

/** Developer-trace events: CPU fallbacks are logged with their reason (ADR 0002). */
export type LocalRuntimeLogEvent =
  | { readonly type: 'state'; readonly state: LocalRuntimeState }
  | { readonly type: 'cpu_fallback'; readonly model: string; readonly reason: string }
  /** A GPU build that exited while loading, before the next backend is tried (LNX1: CUDA, then Vulkan). */
  | {
      readonly type: 'accelerator_failed';
      readonly model: string;
      readonly backend: ComputeBackend;
      readonly next: ComputeBackend;
      readonly detail: string;
    }
  | { readonly type: 'restart'; readonly attempt: number; readonly exitCode: number | null }
  /** A model whose weights are installed but too big for this machine's tier was not loaded. */
  | { readonly type: 'memory_guard'; readonly model: string; readonly tier: HardwareTier }
  /** A call asked for an installed model the process wasn't serving: it restarts serving that one. */
  | { readonly type: 'model_switch'; readonly from: string; readonly to: string }
  | { readonly type: 'idle_unload'; readonly idleMs: number }
  | { readonly type: 'export_pause' }
  | { readonly type: 'export_resume' };

export interface LocalRuntime {
  readonly spec: LocalRuntimeSpec;
  /** Manifest components this tier installs: the runtimes plus the models the tier runs. */
  componentsFor(tier: HardwareTier): readonly string[];
  /** Downloads what is missing for the tier (idempotent). Resolves with the model ids ready to load. */
  ensureInstalled(
    tier: HardwareTier,
    options?: { readonly signal?: AbortSignal },
  ): AsyncResult<readonly string[]>;
  /**
   * Starts the runtime and supervises it; restarts it after a crash. It serves the first installed model the tier
   * allows, in spec order, or `model` when that one is installed and allowed (it is then preferred until another is
   * asked for).
   */
  start(options?: {
    readonly signal?: AbortSignal;
    readonly model?: string;
  }): AsyncResult<LocalRuntimeEndpoint>;
  stop(): AsyncResult<void>;
  status(): LocalRuntimeStatus;
  /** Set while running. */
  endpoint(): LocalRuntimeEndpoint | undefined;
  /** The model the running process serves; undefined while nothing runs. */
  servedModel(): string | undefined;
  /**
   * Whether a start asked for `model` would serve it: installed now (with its server), allowed on the tier, and its
   * last launch didn't fail.
   */
  canServe(model: string): Promise<boolean>;
  loadedModels(): AsyncResult<readonly LoadedLocalModel[]>;
  onStatus(listener: (status: LocalRuntimeStatus) => void): () => void;
}
