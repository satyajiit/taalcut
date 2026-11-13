// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The runtime-independent half of the embedded local runtime: installs the
 * tier's components, launches the driver, restarts it after a crash (with
 * backoff, up to a limit), and reports where each model actually runs. A model
 * that runs on the CPU is logged with its reason (ADR 0002). Installed models
 * above the machine's tier are never loaded (memory guard). One process serves
 * one model: the first installed one the tier allows, or the one last asked
 * for by name (`start({ model })`), on the engine that model names (MLX1).
 */
import { err, ok, raceAbort, type AsyncResult, type Result, type TaalcutError } from '@taalcut/core';
import { LocalRuntimeFailed, LocalRuntimeUnavailable } from '../errors';
import { isAccelerated, selectCompute, type ComputeBackend, type ComputeChoice } from '../hardware/compute';
import type { HardwareTier } from '../hardware/types';
import {
  componentsFor as specComponentsFor,
  fitsTier as fits,
  installsOn,
  runtimeComponentOf,
} from './components';
import type {
  ComponentInstaller,
  LaunchGpu,
  LaunchRuntime,
  LaunchModel,
  LoadedLocalModel,
  LocalRuntime,
  LocalRuntimeDriver,
  LocalRuntimeLogEvent,
  LocalRuntimeModel,
  LocalRuntimeSpec,
  LocalRuntimeState,
  LocalRuntimeStatus,
  RunningLocalRuntime,
} from './types';
import { engineOf } from './types';

export interface LocalRuntimeDeps {
  readonly spec: LocalRuntimeSpec;
  readonly installer: ComponentInstaller;
  readonly driver: LocalRuntimeDriver;
  /** This machine's backends (HardwareAssessment.compute.backends). */
  readonly backends: readonly ComputeBackend[];
  /** The GPU the runtime sizes itself for (the probe's CUDA device, its free VRAM). */
  readonly gpu?: LaunchGpu;
  /** TAALCUT_FORCE_CPU (HardwareAssessment.compute.forcedCpu): the CPU, logged as `disabled`. */
  readonly forcedCpu?: boolean;
  /** This machine's tier: installed models that need a higher one are never loaded. Unset: no guard. */
  readonly tier?: HardwareTier;
  /** Restarts after unexpected exits before giving up. Default 3. */
  readonly maxRestarts?: number;
  /** Wait before restart n (1-based). Default 1 s, 2 s, 4 s... */
  readonly restartDelayMs?: (attempt: number) => number;
  readonly log?: (event: LocalRuntimeLogEvent) => void;
}

export function createLocalRuntime(deps: LocalRuntimeDeps): LocalRuntime {
  const { spec, installer, driver } = deps;
  const maxRestarts = deps.maxRestarts ?? 3;
  const restartDelay = deps.restartDelayMs ?? ((n: number) => 1000 * 2 ** (n - 1));
  const listeners = new Set<(status: LocalRuntimeStatus) => void>();
  let state: LocalRuntimeState = 'not_installed';
  let installed: string[] = [];
  let restarts = 0;
  let lastError: TaalcutError | undefined;
  let running: RunningLocalRuntime | undefined;
  /** The model the running process serves. */
  let served: string | undefined;
  /** The model asked for by name; launches put it first while it is installed and allowed. */
  let preferred: string | undefined;
  /** Models whose launch failed: not tried first again until new weights are installed. */
  const unloadable = new Set<string>();
  /** The launch in flight, shared by every caller so two starts never spawn two runtimes. */
  let pending: Promise<Result<RunningLocalRuntime>> | undefined;
  let launchAbort: AbortController | undefined;
  let stopping = false;
  /** Bumped by every launch and stop, so a stale launch or exit watcher knows to stand down. */
  let generation = 0;

  const status = (): LocalRuntimeStatus => ({
    state,
    installedModels: [...installed],
    restarts,
    ...(lastError ? { error: lastError } : {}),
  });
  const setState = (next: LocalRuntimeState, error?: TaalcutError) => {
    state = next;
    lastError = error;
    deps.log?.({ type: 'state', state: next });
    for (const listener of listeners) listener(status());
  };
  const modelsFor = (tier: HardwareTier) => spec.models.filter(installsOn(tier));
  const componentsFor = (tier: HardwareTier): readonly string[] => specComponentsFor(spec, tier);
  /** Where each model should run here; CPU choices are logged with their reason. */
  const expected = (model: LocalRuntimeModel): ComputeChoice =>
    selectCompute(model.compute, deps.backends, { forcedCpu: deps.forcedCpu ?? false });

  /**
   * The installed builds: GPU builds in this machine's backend order (LNX1: the CUDA variant), then the others (a
   * GPU build runs the CPU too, so a forced CPU can use it), then the base.
   */
  async function installedRuntimes(): Promise<LaunchRuntime[]> {
    const builds: LaunchRuntime[] = [];
    const known = Object.keys(spec.runtimeBuilds ?? {}) as ComputeBackend[];
    const order = [
      ...deps.backends.filter((b) => known.includes(b)),
      ...known.filter((b) => !deps.backends.includes(b)),
    ];
    for (const backend of order) {
      const id = spec.runtimeBuilds?.[backend];
      const files = id ? await installer.get(id) : undefined;
      if (files) builds.push({ backend, files });
    }
    const base = await installer.get(spec.runtimeComponentId);
    return base ? [...builds, { files: base }] : builds;
  }

  type Present = LaunchModel & { readonly runtimes: readonly LaunchRuntime[] };

  /** `model`'s files and the builds that can run it, when its weights, projector and server are all installed. */
  async function presentModel(
    model: LocalRuntimeModel,
    llama: readonly LaunchRuntime[],
  ): Promise<Present | undefined> {
    const own = model.runtimeComponentId ? await installer.get(model.runtimeComponentId) : undefined;
    const runtimes = model.runtimeComponentId ? (own ? [{ files: own }] : []) : llama;
    if (runtimes.length === 0) return undefined;
    const files = await installer.get(model.componentId);
    const projector = model.projectorComponentId
      ? await installer.get(model.projectorComponentId)
      : undefined;
    if (!files || (model.projectorComponentId && !projector)) return undefined;
    return { model, files, ...(projector ? { projector } : {}), runtimes };
  }

  /**
   * Models whose weights (and projector, when they have one) are installed, in spec order, with the server that
   * runs them: llama.cpp's builds, or the model's own server's component (a model whose server isn't installed
   * isn't either).
   */
  async function installedModels(llama: readonly LaunchRuntime[]): Promise<Present[]> {
    const models: Present[] = [];
    for (const model of spec.models) {
      const present = await presentModel(model, llama);
      if (present) models.push(present);
    }
    return models;
  }

  async function launch(signal: AbortSignal): AsyncResult<RunningLocalRuntime> {
    const present = await installedModels(await installedRuntimes());
    if (present.length === 0) {
      setState('not_installed');
      return err(LocalRuntimeUnavailable({ state: 'not_installed' }));
    }
    const tier = deps.tier;
    const fitting = tier ? present.filter((m) => fits(tier)(m.model)) : present;
    if (tier) {
      for (const { model } of present)
        if (!fits(tier)(model)) deps.log?.({ type: 'memory_guard', model: model.id, tier });
    }
    if (fitting.length === 0) return err(LocalRuntimeUnavailable({ state: 'insufficient_memory' }));
    installed = fitting.map((m) => m.model.id);
    // The model asked for by name first, then spec order; the process runs the first one's engine, with the others
    // that engine serves behind it.
    const loadable = fitting.filter((m) => !unloadable.has(m.model.id));
    const first = loadable.find((m) => m.model.id === preferred) ?? loadable[0] ?? fitting[0]!;
    const sameServer = (m: (typeof fitting)[number]) =>
      engineOf(m.model) === engineOf(first.model) &&
      runtimeComponentOf(spec, m.model) === runtimeComponentOf(spec, first.model);
    const allowed: LaunchModel[] = [first, ...fitting.filter((m) => m !== first && sameServer(m))].map(
      (m) => ({ model: m.model, files: m.files, ...(m.projector ? { projector: m.projector } : {}) }),
    );
    const runtimes = first.runtimes;
    const runtime = runtimes[0]!.files;
    for (const { model } of allowed) {
      const where = expected(model);
      if (!where.accelerated)
        deps.log?.({ type: 'cpu_fallback', model: model.id, reason: where.cpuReason ?? '' });
    }
    setState('starting');
    const launchedAt = generation;
    try {
      const started = await driver.launch({
        runtime,
        runtimes,
        models: allowed,
        backends: deps.backends,
        ...(deps.gpu ? { gpu: deps.gpu } : {}),
        ...(deps.forcedCpu ? { forcedCpu: true } : {}),
        signal,
      });
      if (stopping || launchedAt !== generation) {
        // stop() ran while it was starting: don't leave an orphan process behind.
        await started.stop();
        return err(LocalRuntimeUnavailable({ state: 'stopping' }));
      }
      running = started;
      served = first.model.id;
      generation += 1;
      setState('running');
      watch(started, generation);
      return ok(started);
    } catch (cause) {
      if (stopping || launchedAt !== generation) return err(LocalRuntimeUnavailable({ state: 'stopping' }));
      unloadable.add(first.model.id);
      const error = LocalRuntimeFailed(
        { step: 'start' },
        { detail: cause instanceof Error ? cause.message : String(cause) },
      );
      setState('failed', error);
      return err(error);
    }
  }

  function launchOnce(): AsyncResult<RunningLocalRuntime> {
    if (running) return Promise.resolve(ok(running));
    if (!pending) {
      const controller = new AbortController();
      launchAbort = controller;
      pending = launch(controller.signal).finally(() => {
        pending = undefined;
        if (launchAbort === controller) launchAbort = undefined;
      });
    }
    return pending;
  }

  /** Restarts the runtime after an exit nobody asked for. */
  function watch(instance: RunningLocalRuntime, id: number): void {
    void instance.exited.then(async ({ code }) => {
      if (stopping || id !== generation) return;
      running = undefined;
      served = undefined;
      if (restarts >= maxRestarts) {
        setState('failed', LocalRuntimeFailed({ step: 'restart' }, { detail: `Exited ${code} too often.` }));
        return;
      }
      restarts += 1;
      deps.log?.({ type: 'restart', attempt: restarts, exitCode: code });
      setState('crashed');
      await new Promise((resolve) => setTimeout(resolve, restartDelay(restarts)));
      if (!stopping && id === generation) await launchOnce();
    });
  }

  return {
    spec,
    componentsFor,
    async ensureInstalled(tier, options = {}) {
      const ids = componentsFor(tier);
      // A tier with no local model installs nothing, not even the runtime.
      if (ids.length === 0) return ok([]);
      // A running runtime keeps serving while new weights download; they load on the next start.
      const wasRunning = running !== undefined;
      if (!wasRunning) setState('installing');
      for (const id of ids) {
        // The runtime as the build the download set picks here (LNX1-TRM: CUDA once NVIDIA's terms are accepted, else
        // Vulkan, else the base); the weights as they are.
        const result = await installer.install(id, {
          ...(options.signal ? { signal: options.signal } : {}),
          ...(id === spec.runtimeComponentId ? { variant: true } : {}),
        });
        if (!result.ok) {
          if (!wasRunning) setState('not_installed', result.error);
          return result;
        }
      }
      const ready = modelsFor(tier).map((m) => m.id);
      unloadable.clear();
      if (!wasRunning) {
        installed = ready;
        setState('installed');
      }
      return ok(ready);
    },
    async start(options = {}) {
      if (options.model && spec.models.some((m) => m.id === options.model)) preferred = options.model;
      if (running) return ok(running.endpoint);
      if (!pending) {
        stopping = false;
        restarts = 0;
      }
      // The launch is shared: a caller giving up stops waiting, it doesn't kill the runtime for the others.
      const started = await raceAbort(launchOnce(), options.signal);
      return started.ok ? ok(started.value.endpoint) : started;
    },
    async stop() {
      stopping = true;
      generation += 1;
      launchAbort?.abort();
      if (pending) await pending;
      const instance = running;
      running = undefined;
      served = undefined;
      if (!instance) {
        if (state === 'starting' || state === 'crashed') setState('installed');
        return ok(undefined);
      }
      setState('stopping');
      try {
        await instance.stop();
      } finally {
        setState('installed');
      }
      return ok(undefined);
    },
    status,
    endpoint: () => running?.endpoint,
    servedModel: () => (running ? served : undefined),
    async canServe(id) {
      const model = spec.models.find((m) => m.id === id);
      if (!model || unloadable.has(id) || (deps.tier && !fits(deps.tier)(model))) return false;
      // Installed since the last launch counts too: the download runs in another process.
      return (
        (await presentModel(model, model.runtimeComponentId ? [] : await installedRuntimes())) !== undefined
      );
    },
    async loadedModels(): AsyncResult<readonly LoadedLocalModel[]> {
      if (!running) return err(LocalRuntimeUnavailable({ state }));
      const reported = await running.loadedModels();
      return ok(
        reported.map(({ id, backend, memoryBytes }) => {
          const model = spec.models.find((m) => m.id === id);
          const plan = model ? expected(model) : undefined;
          return {
            id,
            compute: actualCompute(backend, plan, id, deps.log),
            ...(memoryBytes ? { memoryBytes } : {}),
          };
        }),
      );
    },
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

/** What the runtime reports, labelled; a CPU run where the GPU was expected means the GPU path failed. */
function actualCompute(
  backend: ComputeBackend,
  plan: ComputeChoice | undefined,
  model: string,
  log: LocalRuntimeDeps['log'],
): ComputeChoice {
  if (isAccelerated(backend)) return { backend, accelerated: true, labelKey: `models.compute.${backend}` };
  const cpuReason = plan?.accelerated
    ? 'gpu_failed_at_runtime'
    : (plan?.cpuReason ?? 'no_accelerated_backend');
  if (plan?.accelerated) log?.({ type: 'cpu_fallback', model, reason: cpuReason });
  return { backend: 'cpu', accelerated: false, cpuReason, labelKey: 'models.compute.cpu' };
}
