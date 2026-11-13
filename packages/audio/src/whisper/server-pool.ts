// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Persistent whisper (IX-A3): one `whisper-server` per binary and model, started on first use and kept while it
 * is used, so the model loads once instead of once per call. Requests to one process go one at a time (the
 * server answers one at a time anyway, and progress lines belong to the request in flight).
 * - Idle: a process nobody has asked for `idleMs` is stopped (its model unloaded).
 * - Crash: a request whose process died under it runs once more on a fresh process; a process that died while
 *   idle is started again by the next request.
 * - GPU first (ADR 0002): Metal (the plan's accelerator); a process that dies loading with a GPU error starts
 *   again on the CPU (`-ng`), and one that found no GPU runs there; either emits `compute.fallback` once per model.
 * - Abort: the request's connection closes and whisper.cpp stops at its next step; the process stays up.
 * - Every launch is in the registry, so a later pool stops servers a killed jobs process left running.
 */
import { err, type AsyncResult, type ComputeBackend, type ComputeFallbackEvent } from '@taalcut/core';
import { EngineUnavailable } from '../errors';
import type { WhisperDecoder } from './decoder';
import { poolDecoder, type Inference, type PoolFailure } from './pool-decoder';
import { serverKey } from './server-args';
import { createServerLauncher, type ServerLauncher } from './server-launcher';
import type { ServerLaunchDeps } from './server-process';
import type { ServerRegistry } from './server-registry';
import type { VerboseJson } from './server-response';
import { enqueue, newSlot, slotProcess, stopSlot, type Slot } from './server-slot';

export interface WhisperServerPoolDeps {
  readonly launch: ServerLaunchDeps;
  readonly registry?: ServerRegistry;
  /** The accelerator the backend plan chose (Metal on a Mac); null starts on the CPU (the plan logged why). */
  readonly accelerator: ComputeBackend | null;
  /** The CPU build a slot falls back to (server-launcher.ts); absent: the slot's binary with `-ng`. */
  readonly cpuBinary?: string;
  /** Default 60 s. */
  readonly idleMs?: number;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  readonly log?: (message: string) => void;
  readonly ownerPid?: number;
}

export interface WhisperServerPoolStats {
  readonly launches: number;
  readonly requests: number;
  readonly running: number;
}

export interface WhisperServerPool {
  /** A decoder whose calls go to this pool's processes of `binary` (a whisper-server). */
  decoder(binary: string): WhisperDecoder;
  stats(): WhisperServerPoolStats;
  close(): Promise<void>;
}

/** Why a call on a closed pool is refused: its process is stopping (or a test closed it). */
const CLOSED = { detail: 'the whisper-server pool is closed: its process is stopping' };

interface PoolState {
  readonly slots: Map<string, Slot>;
  readonly launcher: ServerLauncher;
  readonly log: ((message: string) => void) | undefined;
  requests: number;
  closed: boolean;
}

function slotOf(slots: Map<string, Slot>, binary: string, model: string): Slot {
  const key = serverKey({ binary, model, gpu: true });
  const existing = slots.get(key);
  if (existing) return existing;
  const slot = newSlot();
  slots.set(key, slot);
  return slot;
}

/** The request on the slot's process; one that died under it runs once more on a fresh process. */
async function attempt(
  state: PoolState,
  slot: Slot,
  binary: string,
  model: string,
  infer: Inference,
): AsyncResult<VerboseJson, PoolFailure> {
  for (let tries = 0; ; tries++) {
    if (state.closed) return err({ kind: 'launch', error: EngineUnavailable({ engine: 'whisper' }, CLOSED) });
    const started = await slotProcess(slot, () => state.launcher.launch(slot, binary, model));
    if (!started.ok) return err({ kind: 'launch', error: started.error });
    state.requests += 1;
    const answer = await infer(started.value);
    if (answer.ok || answer.error.kind !== 'crashed' || tries > 0) return answer;
    state.log?.(`[audio] whisper-server for ${model} exited during a request; starting another`);
  }
}

async function closePool(state: PoolState): Promise<void> {
  state.closed = true;
  const all = [...state.slots.values()];
  state.slots.clear();
  await Promise.all(all.map(stopSlot));
}

export function createWhisperServerPool(deps: WhisperServerPoolDeps): WhisperServerPool {
  const idleMs = deps.idleMs ?? 60_000;
  const state: PoolState = {
    slots: new Map(),
    launcher: createServerLauncher(deps),
    log: deps.log,
    requests: 0,
    closed: false,
  };
  const call = (binary: string, model: string, infer: Inference) => {
    const slot = slotOf(state.slots, binary, model);
    return enqueue(slot, idleMs, () => attempt(state, slot, binary, model, infer));
  };
  return {
    decoder: (binary) => poolDecoder(call, binary),
    stats: () => ({
      launches: state.launcher.launches(),
      requests: state.requests,
      running: [...state.slots.values()].filter((slot) => slot.process !== undefined).length,
    }),
    close: () => closePool(state),
  };
}
