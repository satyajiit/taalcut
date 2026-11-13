// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which rows this machine can use. The platform's rows are candidates; the host's hardware probe narrows them
 * (an NVIDIA card names `cuda`; `CUDA_VISIBLE_DEVICES=-1` or no GPU names none), and each row's device trial proves
 * the rest open, once per MediaService. A row that fails its trial is left out with FFmpeg's reason, which every
 * CPU fallback it causes then carries (ADR 0002: no unexplained fallback).
 */
import { ok, type AsyncResult, type Result } from '@taalcut/core';
import { failureGist } from '../backends';
import { runFfmpeg, type MediaContext, type VideoBackendSource } from '../ffmpeg';
import { hardwareBackends, hwVideoBackend, machineHardwareBackends } from './table';
import type { HardwareBackend, MachineVideoBackends } from './types';

/**
 * What the host's probe says: the rows it names (`engineHardwareBackends`), and `disabled` when hardware is turned
 * off on purpose (`TAALCUT_FORCE_CPU=1`). Undefined when it doesn't know.
 */
export interface NamedMachine {
  readonly backends: readonly HardwareBackend[];
  readonly disabled?: string;
}
export type NamedVideoBackends = () => Promise<NamedMachine | undefined>;

/** The machine's rows: proven by the context's source, else the platform's defaults, unproven. */
export function machineVideoBackends(
  ctx: MediaContext,
  signal?: AbortSignal,
): AsyncResult<MachineVideoBackends> {
  if (ctx.videoBackends) return ctx.videoBackends.get(ctx, signal);
  return Promise.resolve(ok({ backends: hardwareBackends(ctx.platform ?? process.platform) }));
}

/** Runs each candidate's device trial; the ones that pass, in order, and why the others failed. */
export async function proveVideoBackends(
  ctx: MediaContext,
  candidates: readonly HardwareBackend[],
  signal?: AbortSignal,
): AsyncResult<MachineVideoBackends> {
  const backends: HardwareBackend[] = [];
  const missing: string[] = [];
  for (const id of candidates) {
    const trial = hwVideoBackend(id).deviceTrial;
    if (!trial) {
      backends.push(id);
      continue;
    }
    const ran = await runFfmpeg(ctx, trial, {
      // Device memory and filter kernels only: no decoder or encoder session.
      holdsVideoSession: false,
      timeoutMs: 30_000,
      ...(signal ? { signal } : {}),
    });
    if (ran.ok) backends.push(id);
    else if (ran.error.code === 'media.cancelled') return ran;
    else
      missing.push(
        `${id}: ${failureGist((ran.error.detail ?? ran.error.code).split('\n').slice(1).join('\n'))}`,
      );
  }
  return ok({ backends, ...(missing.length > 0 ? { missing: missing.join('; ') } : {}) });
}

/**
 * Remembers one machine answer for a MediaService: a GPU doesn't come or go while the app runs. A cancelled proof
 * is not kept. `named` is the host's probe; without one (or when it can't tell) the platform's default rows are
 * the candidates.
 */
export class VideoBackendSelection implements VideoBackendSource {
  private answer: Promise<Result<MachineVideoBackends>> | undefined;

  constructor(private readonly named?: NamedVideoBackends) {}

  get(ctx: MediaContext, signal?: AbortSignal): AsyncResult<MachineVideoBackends> {
    if (!this.answer) {
      const pending = this.prove(ctx, signal);
      this.answer = pending;
      void pending.then((result) => {
        if (!result.ok && this.answer === pending) this.answer = undefined;
      });
    }
    return this.answer;
  }

  private async prove(ctx: MediaContext, signal?: AbortSignal): AsyncResult<MachineVideoBackends> {
    const platform = ctx.platform ?? process.platform;
    const probed = await this.named?.().catch(() => undefined);
    if (probed?.disabled) return ok({ backends: [], disabled: probed.disabled });
    const named = probed?.backends;
    const candidates = named ? machineHardwareBackends(platform, named) : hardwareBackends(platform);
    const proven = await proveVideoBackends({ ...ctx, videoBackends: undefined }, candidates, signal);
    if (!proven.ok || !named) return proven;
    const left = hardwareBackends(platform).filter((id) => !named.includes(id));
    if (left.length === 0) return proven;
    const why = `${left.join(', ')}: not on this machine (hardware probe)`;
    const missing = proven.value.missing ? `${why}; ${proven.value.missing}` : why;
    return ok({ ...proven.value, missing });
  }
}

/**
 * A fixed answer, for hosts and tests that already know (`[]`: no hardware video at all; `{ disabled }`: turned
 * off on purpose).
 */
export function knownVideoBackends(
  backends: readonly HardwareBackend[],
  why: { readonly missing?: string; readonly disabled?: string } = {},
): VideoBackendSource {
  const answer: MachineVideoBackends = {
    backends: why.disabled ? [] : backends,
    ...(why.missing ? { missing: why.missing } : {}),
    ...(why.disabled ? { disabled: why.disabled } : {}),
  };
  return { get: () => Promise.resolve(ok(answer)) };
}
