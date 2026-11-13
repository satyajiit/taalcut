// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Launches a slot's whisper-server, GPU first (ADR 0002): a process that dies loading with a GPU error starts
 * again on the CPU (`-ng`), and one that found no GPU runs there; either emits `compute.fallback` once per model
 * and marks the slot CPU-only. Every launch is written to the registry (when there is one) and removed when the
 * process exits, so a later pool stops servers a killed jobs process left running.
 */
import {
  computeFallbackEvent,
  cpuFallback,
  err,
  ok,
  type ComputeBackend,
  type ComputeFallbackEvent,
  type ComputeFallbackReason,
  type Result,
} from '@taalcut/core';
import { EngineUnavailable } from '../errors';
import type { WhisperServerConfig } from './server-args';
import {
  launchWhisperServer,
  type LaunchFailure,
  type ServerLaunchDeps,
  type WhisperServerProcess,
} from './server-process';
import type { ServerRegistry } from './server-registry';
import type { Slot } from './server-slot';

export interface ServerLauncherDeps {
  readonly launch: ServerLaunchDeps;
  readonly registry?: ServerRegistry;
  /** The accelerator the backend plan chose; null starts on the CPU. */
  readonly accelerator: ComputeBackend | null;
  /**
   * The CPU build to start when the GPU one fails (Linux's `whisper-server` next to `whisper-server-cuda`, whose
   * libraries may not load at all); absent: the same binary with `-ng`.
   */
  readonly cpuBinary?: string;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  readonly log?: (message: string) => void;
  readonly ownerPid?: number;
}

export interface ServerLauncher {
  /** A process for this slot's binary and model, on the GPU unless the slot fell back to the CPU. */
  launch(slot: Slot, binary: string, model: string): Promise<Result<WhisperServerProcess>>;
  launches(): number;
}

interface LauncherState {
  readonly deps: ServerLauncherDeps;
  readonly wanted: readonly ComputeBackend[];
  launches: number;
}

function fallBack(
  state: LauncherState,
  slot: Slot,
  model: string,
  reason: ComputeFallbackReason,
  detail: string,
): void {
  slot.cpu = true;
  if (slot.fallbackSent) return;
  slot.fallbackSent = true;
  state.deps.log?.(
    `[audio] whisper-server for ${model} runs on the CPU (${reason}): ${detail.slice(0, 300)}`,
  );
  const choice = cpuFallback(reason, `${model}: ${detail}`.slice(0, 1500));
  if (choice.backend === 'cpu')
    state.deps.onFallback?.(computeFallbackEvent('audio.whisper', [...state.wanted], choice.fallback));
}

/** The record only lets a later process stop an orphan: failing to write or remove it costs nothing now. */
async function record(deps: ServerLauncherDeps, server: WhisperServerProcess): Promise<void> {
  if (server.pid === undefined || !deps.registry) return;
  const registry = deps.registry;
  const entry = {
    owner: deps.ownerPid ?? process.pid,
    pid: server.pid,
    port: server.port,
    secret: server.secret,
  };
  const unrecorded = (cause: unknown) => deps.log?.(`[audio] whisper-server registry: ${String(cause)}`);
  await registry.record(entry).catch(unrecorded);
  void server.exited.then(() => registry.forget(entry)).catch(unrecorded);
}

async function start(
  state: LauncherState,
  slot: Slot,
  config: WhisperServerConfig,
): Promise<Result<WhisperServerProcess>> {
  state.launches += 1;
  const started = await launchWhisperServer(config, state.deps.launch).catch((cause: unknown) =>
    // A spawn or port that throws (rather than a server that exits) is a launch failure like any other.
    err<LaunchFailure>({
      gpuFailed: false,
      error: EngineUnavailable({ engine: 'whisper' }, { detail: String(cause) }),
    }),
  );
  if (!started.ok) {
    if (!started.error.gpuFailed) return err(started.error.error);
    fallBack(
      state,
      slot,
      config.model,
      'accelerator_failed',
      started.error.error.detail ?? 'GPU init failed',
    );
    return start(state, slot, { ...config, binary: state.deps.cpuBinary ?? config.binary, gpu: false });
  }
  const server = started.value;
  if (config.gpu && server.backend === 'cpu')
    fallBack(state, slot, config.model, 'no_accelerator', 'no GPU found');
  await record(state.deps, server);
  return ok(server);
}

export function createServerLauncher(deps: ServerLauncherDeps): ServerLauncher {
  const state: LauncherState = { deps, wanted: [deps.accelerator ?? 'metal', 'cpu'], launches: 0 };
  return {
    launch: (slot, binary, model) => {
      const gpu = deps.accelerator !== null && !slot.cpu;
      return start(state, slot, { binary: gpu ? binary : (deps.cpuBinary ?? binary), model, gpu });
    },
    launches: () => state.launches,
  };
}
