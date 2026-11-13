// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The llama.cpp `llama-server` sidecar (spike 08): one process per launch on
 * a free loopback port, guarded by a per-launch API key, ready once /health
 * says so. Killing the process unloads the model. Spawning goes through
 * SpawnPort, so the desktop main process owns child_process and tests run a
 * fake server script. If the GPU launch dies twice while loading, it moves to
 * another installed GPU build (Vulkan after CUDA), then the CPU, and logs why
 * (ADR 0002).
 *
 * On a GPU with memory of its own (LNX1, Linux NVIDIA) the CUDA build runs on
 * the probe's device (`--device CUDA<n>`, so a CUDA that won't start is an exit,
 * not a quiet CPU run), every layer on it, and as many slots of the tier's window
 * as the free VRAM holds (`vramSlots`). The Vulkan build is pinned to the probe's
 * GPU among the devices it lists (vulkan-device.ts), and sized the same way once
 * pinned. The CPU runs `--device none` on whichever build is installed, the base
 * first.
 */
import { join } from 'node:path';
import type { FetchFn } from '../client/http-meter';
import { isAccelerated, selectCompute, type ComputeBackend } from '../hardware/compute';
import { KV_CACHE_TYPE, vramSlots, type LlamaSlots } from './llama-cpp-spec';
import { ExitedWhileLoading, startSidecar, type SpawnPort } from './sidecar-process';
import { parseListedDevices, vulkanDeviceFor } from './vulkan-device';
import type {
  InstalledComponentRef,
  LaunchInput,
  LaunchRuntime,
  LocalRuntimeDriver,
  LocalRuntimeLogEvent,
  LocalRuntimeModel,
  RunningLocalRuntime,
} from './types';

export type { SidecarExit, SidecarProcess, SpawnPort, SpawnRequest } from './sidecar-process';

export interface LlamaServerDriverDeps {
  readonly spawn: SpawnPort;
  /** A TCP port that is free on 127.0.0.1 right now. */
  readonly freePort: () => Promise<number>;
  /** For the /health poll. Default: globalThis.fetch. */
  readonly fetch?: FetchFn;
  /** The executable inside the runtime component. Default `<path>/llama-server` (`.exe` on Windows). */
  readonly executable?: (runtime: InstalledComponentRef) => string;
  /** Default: a random UUID per launch. */
  readonly newApiKey?: () => string;
  /** Give up on /health after this long. Default 180 s (a cold 4B load took 13 s on an M-series Max). */
  readonly startTimeoutMs?: number;
  readonly healthIntervalMs?: number;
  /** SIGTERM, then SIGKILL after this long. Default 5 s. */
  readonly stopGraceMs?: number;
  /**
   * Variables the GPU builds need from this process (LNX1): LD_LIBRARY_PATH for cuda-runtime-13, which the
   * utility process was forked with, and CUDA_VISIBLE_DEVICES. Nothing else of process.env goes in. A function is
   * read at each spawn (the desktop's `acceleratorEnv()`: a cuda-runtime-13 installed since this process started).
   */
  readonly env?: Readonly<Record<string, string>> | (() => Readonly<Record<string, string>>);
  readonly log?: (event: LocalRuntimeLogEvent) => void;
}

export interface LlamaServerArgsInput {
  readonly model: LocalRuntimeModel;
  readonly weights: string;
  readonly projector?: string;
  readonly port: number;
  readonly backend: ComputeBackend;
  /** Slots and context (`vramSlots`); default one slot at the model's window, every layer on the GPU. */
  readonly slots?: LlamaSlots;
  /**
   * `--device`: `CUDA<n>` for CUDA, the probe's GPU for Vulkan, `none` for the CPU on a GPU build; absent:
   * llama.cpp's choice.
   */
  readonly device?: string;
}

/** Qwen-VL grounding wants at least this many tokens per image (llama-server's own warning, spike 08). */
export const IMAGE_MIN_TOKENS = 1024;

/** Flags measured in spike 08 and LRN1-CTX (the KV cache), plus the ones that keep the server private to Taalcut. */
export function llamaServerArgs(input: LlamaServerArgsInput): string[] {
  const gpu = isAccelerated(input.backend);
  const slots = input.slots ?? { parallel: 1, ctxSize: input.model.contextWindow, allLayers: true };
  // --fit (on by default) places the layers only when --n-gpu-layers is unset.
  const layers = gpu ? (slots.allLayers ? ['--n-gpu-layers', '99'] : []) : ['--n-gpu-layers', '0'];
  const vision = input.projector
    ? [
        '--mmproj',
        input.projector,
        '--image-min-tokens',
        String(IMAGE_MIN_TOKENS),
        ...(gpu ? [] : ['--no-mmproj-offload']),
      ]
    : [];
  return [
    '--model',
    input.weights,
    '--alias',
    input.model.id,
    '--host',
    '127.0.0.1',
    '--port',
    String(input.port),
    // The model's default context (262,144 for Qwen3.5) would exhaust an 8 GB Mac and crowd a 16 GB one.
    // Each slot gets ctx-size / parallel: an explicit --parallel turns the unified cache off.
    '--ctx-size',
    String(slots.ctxSize),
    // One slot on unified memory: video work shares the GPU, and text decode halved beside a frame job (spike 08).
    '--parallel',
    String(slots.parallel),
    ...(input.device ? ['--device', input.device] : []),
    ...layers,
    // The KV cache at q8_0, the footprint each tier's window is measured with (llama-cpp-spec.ts). Its V half needs
    // flash attention: b11571 refuses to start with it off and turns `auto` on anyway, on the CPU too, so it is on.
    '--cache-type-k',
    KV_CACHE_TYPE,
    '--cache-type-v',
    KV_CACHE_TYPE,
    '--flash-attn',
    'on',
    '--jinja',
    // After --jinja, so any template is taken: the model's own, its tools written compact (LRN1-CTX).
    ...(input.model.chatTemplate ? ['--chat-template', input.model.chatTemplate] : []),
    // Nothing but Taalcut talks to it: no web UI, no slot monitor (it shows prompts), no downloads.
    '--no-webui',
    '--no-slots',
    '--offline',
    // AGT1: the host prompt cache at the tier's cap (llama-cpp-spec.ts HOST_PROMPT_CACHE_MIB); b11571's default is 8 GiB.
    '--cache-ram',
    String(input.model.hostCacheMiB ?? 0),
    ...vision,
  ];
}

/** `--list-devices` only loads the backends: a build that takes longer than this has no device worth pinning. */
const LIST_DEVICES_MS = 15_000;

export function createLlamaServerDriver(deps: LlamaServerDriverDeps): LocalRuntimeDriver {
  const fetchFn: FetchFn = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const executable =
    deps.executable ??
    ((runtime) => join(runtime.path, process.platform === 'win32' ? 'llama-server.exe' : 'llama-server'));
  const newApiKey = deps.newApiKey ?? (() => globalThis.crypto.randomUUID());
  const startTimeoutMs = deps.startTimeoutMs ?? 180_000;
  const healthIntervalMs = deps.healthIntervalMs ?? 250;
  const stopGraceMs = deps.stopGraceMs ?? 5_000;
  const listed = new Map<string, Promise<string[]>>();
  const gpuEnv = (): Readonly<Record<string, string>> =>
    typeof deps.env === 'function' ? deps.env() : (deps.env ?? {});

  /** What the build prints for `--list-devices`, once per build; nothing if it won't say. */
  function listDevices(command: string): Promise<string[]> {
    const known = listed.get(command);
    if (known) return known;
    const lines: string[] = [];
    const child = deps.spawn.spawn({
      command,
      args: ['--list-devices'],
      env: { ...gpuEnv() },
      onOutput: (line) => lines.push(line),
    });
    const late = setTimeout(() => child.kill('SIGKILL'), LIST_DEVICES_MS);
    const done = child.exited.then(
      () => lines,
      () => [],
    );
    void done.finally(() => clearTimeout(late));
    listed.set(command, done);
    return done;
  }

  async function deviceFor(attempt: Attempt, gpu: LaunchInput['gpu']): Promise<string | undefined> {
    if (attempt.backend === 'cuda') return `CUDA${gpu?.cudaDeviceId ?? 0}`;
    if (attempt.backend === 'cpu') return 'none';
    if (attempt.backend !== 'vulkan' || (!gpu?.name && !gpu?.totalVramBytes)) return undefined;
    return vulkanDeviceFor(parseListedDevices(await listDevices(executable(attempt.runtime))), gpu);
  }

  async function startOn(input: LaunchInput, attempt: Attempt): Promise<RunningLocalRuntime> {
    const { backend } = attempt;
    // launch() checked models[0] exists.
    const { model, files, projector } = input.models[0]!;
    const weights = files.file;
    if (!weights) throw new Error(`Component ${files.id} has no model file.`);
    if (projector && !projector.file) throw new Error(`Component ${projector.id} has no projector file.`);
    const port = await deps.freePort();
    const apiKey = newApiKey();
    const device = await deviceFor(attempt, input.gpu);
    const sized = backend === 'cuda' || (backend === 'vulkan' && device !== undefined);
    const server = await startSidecar({
      spawn: deps.spawn,
      fetch: fetchFn,
      name: 'llama-server',
      command: executable(attempt.runtime),
      args: llamaServerArgs({
        model,
        weights,
        ...(projector?.file ? { projector: projector.file } : {}),
        port,
        backend,
        ...(sized ? { slots: vramSlots(model, input.gpu?.vramBytes) } : {}),
        ...(device ? { device } : {}),
      }),
      env: { ...gpuEnv(), LLAMA_API_KEY: apiKey },
      port,
      apiKey,
      signal: input.signal,
      startTimeoutMs,
      healthIntervalMs,
      stopGraceMs,
    });
    return {
      endpoint: { kind: 'openai-compatible', baseUrl: `${server.origin}/v1`, apiKey, models: [model.id] },
      exited: server.exited.then(({ code, signal }) => ({ code, ...(signal ? { reason: signal } : {}) })),
      stop: server.stop,
      loadedModels: async () => (server.exit() ? [] : [{ id: model.id, backend }]),
    };
  }

  return {
    async launch(input) {
      const first = input.models[0];
      if (!first) throw new Error('No model to load.');
      const order = attempts(input, first.model);
      if (
        order[0]?.backend === 'cpu' &&
        isAccelerated(selectCompute(first.model.compute, input.backends).backend)
      )
        deps.log?.({ type: 'cpu_fallback', model: first.model.id, reason: 'gpu_build_not_installed' });
      for (const [index, attempt] of order.entries()) {
        const next = order[index + 1];
        try {
          return await startOn(input, attempt);
        } catch (cause) {
          if (!(cause instanceof ExitedWhileLoading) || !next || input.signal.aborted) throw cause;
          if (attempt.backend !== 'cpu' && next.backend !== attempt.backend)
            deps.log?.({
              type: 'accelerator_failed',
              model: first.model.id,
              backend: attempt.backend,
              next: next.backend,
              detail: failureDetail(attempt.backend, cause.message),
            });
          if (next.backend === 'cpu' && attempt.backend !== 'cpu')
            deps.log?.({ type: 'cpu_fallback', model: first.model.id, reason: 'gpu_failed_at_runtime' });
        }
      }
      throw new Error('No backend left to try.');
    },
  };
}

interface Attempt {
  readonly backend: ComputeBackend;
  readonly runtime: InstalledComponentRef;
}

/** The base build runs Metal (macOS) and the CPU; a GPU build runs its backend and the CPU. */
function buildFor(
  builds: readonly LaunchRuntime[],
  backend: ComputeBackend,
): InstalledComponentRef | undefined {
  const own = builds.find((build) => build.backend === backend)?.files;
  if (own) return own;
  return backend === 'metal' || backend === 'cpu' ? builds.find((build) => !build.backend)?.files : undefined;
}

/**
 * The launches to try, in order. An early exit can be a lost race for the port, so the planned backend gets a
 * second try; a GPU path that fails twice is a GPU problem, and the next installed GPU build the model and machine
 * share takes over, then the CPU (the base build, else a GPU build with `--device none`).
 */
function attempts(input: LaunchInput, model: LocalRuntimeModel): Attempt[] {
  const builds = input.runtimes ?? [{ files: input.runtime }];
  const offered = input.forcedCpu ? [] : input.backends;
  const gpus = model.compute.filter((backend) => isAccelerated(backend) && offered.includes(backend));
  const order: Attempt[] = [];
  for (const backend of gpus) {
    const runtime = buildFor(builds, backend);
    if (!runtime) continue;
    order.push({ backend, runtime });
    if (order.length === 1) order.push({ backend, runtime });
  }
  const cpu = buildFor(builds, 'cpu') ?? builds[0]?.files ?? input.runtime;
  order.push({ backend: 'cpu', runtime: cpu });
  if (order.length === 1) order.push({ backend: 'cpu', runtime: cpu });
  return order;
}

/**
 * How the exit was described and the output's error lines (else its last lines). The CUDA build loads its backend
 * at run time and, when cuda-runtime-13 isn't on the loader's path, says only that `CUDA0` is no device: name the
 * cause.
 */
function failureDetail(backend: ComputeBackend, message: string): string {
  const [exited = '', ...output] = message.split('\n').filter((line) => line.trim() !== '');
  const errors = output.filter((line) => /error|fail|invalid|cannot/i.test(line));
  const detail = [exited, ...(errors.length > 0 ? errors : output).slice(-4)].join('\n').slice(0, 500);
  if (backend !== 'cuda' || !/invalid device: CUDA/.test(message)) return detail;
  return (
    `${detail}\n(the CUDA backend did not load: cuda-runtime-13's libcudart.so.13 and libcublas.so.13 ` +
    'must be on LD_LIBRARY_PATH)'
  );
}
