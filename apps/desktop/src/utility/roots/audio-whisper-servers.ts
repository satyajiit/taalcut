// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's whisper-server pool (packages/audio, IX-A3), made on first use on the backend the ASR plan
 * picks from the hardware profile and the builds installed now (Metal on Apple silicon; CUDA on Linux NVIDIA with
 * `whisper-server-cuda`; the CPU, as a logged fallback, elsewhere, `disabled` under TAALCUT_FORCE_CPU). The jobs
 * run the server of the build the same plan picks (`plannedServer`), and a slot whose GPU build fails to load
 * starts the CPU build (`whisper-server`) when it is installed.
 * Each server has a watchdog that stops it when this process dies (audio's posixServerSpawn, IX-F7). Each launch is
 * also written down under userData, and whatever a previous jobs process left anyway is stopped when this one
 * starts (`sweptWhisperRegistry`, from the jobs root's composition, not on the first whisper call).
 */
import { join } from 'node:path';
import {
  ASR_BACKENDS,
  createServerRegistry,
  createWhisperServerPool,
  freeLoopbackPort,
  planAsrBackend,
  createPosixServerSpawn,
  posixServerSpawn,
  type AsrBackendPlan,
  type ServerRegistry,
  type WhisperServerPool,
} from '@taalcut/audio';
import type { ComputeBackend, ComputeFallbackEvent, Result } from '@taalcut/core';
import { processAlive } from '@taalcut/media';
import { hostPlatform } from '../../platform';

export interface WhisperServersDeps {
  /** The hardware profile's backends, accelerated first. */
  readonly backends: () => Promise<readonly ComputeBackend[]>;
  /** TAALCUT_FORCE_CPU turned the GPUs off (the probe's `forcedCpu`). */
  readonly forcedCpu?: () => Promise<boolean>;
  /** The whisper-server of each build installed now, by component; absent: every build is (the plan alone). */
  readonly builds?: () => Promise<ReadonlyMap<string, string>>;
  /** Default this host's (the platform services'). */
  readonly platform?: NodeJS.Platform;
  /**
   * Variables each server adds at its spawn (machine-accelerators.ts `sidecarAcceleratorEnv`: the installed
   * cuda-runtime-13's folder on LD_LIBRARY_PATH, even when it was installed after this process started).
   */
  readonly sidecarEnv?: () => Readonly<Record<string, string>>;
  readonly onFallback: (event: ComputeFallbackEvent) => void;
  readonly log: (message: string) => void;
}

/** whisper.cpp's CPU build (ASR_BACKENDS: `whisper-server` on every platform). */
const CPU_BUILD =
  ASR_BACKENDS.whisper.find((option) => option.backend === 'cpu')?.component ?? 'whisper-server';

type PlanDeps = Pick<WhisperServersDeps, 'backends' | 'forcedCpu' | 'builds' | 'platform'>;

/** The ASR plan over the hardware and the builds installed now, with those builds' servers. */
export async function whisperPlan(
  deps: PlanDeps,
): Promise<{ readonly plan: Result<AsrBackendPlan>; readonly builds?: ReadonlyMap<string, string> }> {
  const [backends, forcedCpu, builds] = await Promise.all([
    deps.backends(),
    deps.forcedCpu?.(),
    deps.builds?.(),
  ]);
  const plan = planAsrBackend('whisper', {
    backends,
    platform: deps.platform ?? hostPlatform().name,
    ...(forcedCpu ? { forcedCpu } : {}),
    ...(builds ? { installed: (component: string) => builds.has(component) } : {}),
  });
  return { plan, ...(builds ? { builds } : {}) };
}

/** The whisper-server of the build the plan picks; undefined when none is installed. */
export async function plannedServer(deps: PlanDeps): Promise<string | undefined> {
  const { plan, builds } = await whisperPlan(deps);
  return plan.ok ? builds?.get(plan.value.option.component) : undefined;
}

export interface WhisperServers {
  /** The pool, started on the first call. */
  pool(): Promise<WhisperServerPool>;
  close(): Promise<void>;
}

function stopGroup(pid: number): void {
  try {
    process.kill(-pid, 'SIGTERM');
  } catch {
    // Already gone: nothing to stop.
  }
}

/** The registry under userData, after stopping what a previous jobs process left running (logged, never fatal). */
export function sweptWhisperRegistry(userData: string, log: (message: string) => void): ServerRegistry {
  const registry = createServerRegistry({
    dir: join(userData, 'whisper-servers'),
    fetch,
    isAlive: processAlive,
    kill: stopGroup,
  });
  void registry.sweep().then(
    (stopped) => stopped > 0 && log(`[audio] stopped ${stopped} whisper-server(s) a previous run left`),
    (cause: unknown) => log(`[audio] whisper-server sweep failed: ${String(cause)}`),
  );
  return registry;
}

async function plannedPool(
  deps: WhisperServersDeps,
  registry: ServerRegistry,
  workDir: string,
): Promise<WhisperServerPool> {
  const { plan, builds } = await whisperPlan(deps);
  if (plan.ok && plan.value.fallback) deps.onFallback(plan.value.fallback);
  const accelerator = plan.ok && plan.value.option.backend !== 'cpu' ? plan.value.option.backend : null;
  const cpuBinary = builds?.get(CPU_BUILD);
  if (plan.ok)
    deps.log(`[audio] whisper-server on ${plan.value.option.backend} (${plan.value.option.component})`);
  return createWhisperServerPool({
    launch: {
      spawn: deps.sidecarEnv ? createPosixServerSpawn(deps.sidecarEnv) : posixServerSpawn,
      fetch,
      freePort: freeLoopbackPort,
      workDir,
    },
    registry,
    accelerator,
    ...(cpuBinary ? { cpuBinary } : {}),
    onFallback: deps.onFallback,
    log: deps.log,
  });
}

/** `workDir` is the servers' working folder (the asset audio store's root); `registry` is already swept. */
export function createWhisperServers(
  registry: ServerRegistry,
  workDir: string,
  deps: WhisperServersDeps,
): WhisperServers {
  let pool: Promise<WhisperServerPool> | undefined;
  return {
    pool: () => (pool ??= plannedPool(deps, registry, workDir)),
    async close() {
      const started = pool;
      pool = undefined;
      await started?.then((running) => running.close());
    },
  };
}
