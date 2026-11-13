// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LocalRuntimeManager: the session lifecycle around the supervised runtime.
 * Calls lease it (acquire/release), which starts it on first use; it unloads
 * after a quiet spell, stops before an export to give the memory back, and
 * never loads a model too big for the machine's tier. A cold start takes
 * ~13 s (spike 08), so the idle timeout is long: the sidecar should stay up
 * for a working session, not start per turn. A call that names an installed
 * model the process isn't serving (a person's pick of the 4B on a Mac that
 * serves the 9B, MLX1) waits for the calls in flight, then the process
 * restarts serving that one.
 */
import { err, ok, type AsyncResult } from '@taalcut/core';
import { LocalRuntimeUnavailable } from '../errors';
import type { HardwareTier } from '../hardware/types';
import { createLocalRuntime, type LocalRuntimeDeps } from './supervisor';
import type { LocalRuntime, LocalRuntimeEndpoint, LocalRuntimeStatus } from './types';

export interface LocalRuntimeManagerDeps extends Omit<LocalRuntimeDeps, 'tier'> {
  /** This machine's tier: installed models that need a higher one are never loaded (memory guard). */
  readonly tier: HardwareTier;
  /** Stop the runtime after this long with no call in flight. Default 15 minutes; 0 keeps it up. */
  readonly idleUnloadMs?: number;
  /** stopForExport waits this long for calls in flight, then stops anyway. Default 30 s. */
  readonly drainTimeoutMs?: number;
}

export interface LocalRuntimeLease {
  readonly endpoint: LocalRuntimeEndpoint;
  /** Ends the hold; idempotent. */
  release(): void;
}

export interface LocalRuntimeManager extends LocalRuntime {
  readonly tier: HardwareTier;
  /**
   * Starts the runtime if it isn't running and holds it until release(), so it
   * can't idle out mid-call. ModelClient takes one per on-device call
   * (attachLocalRuntime's localLease). Fails as a value while paused.
   */
  acquire(options?: {
    readonly signal?: AbortSignal;
    readonly model?: string;
  }): AsyncResult<LocalRuntimeLease>;
  /** Before an export: refuses new calls, waits for calls in flight, then stops the runtime. */
  stopForExport(): AsyncResult<void>;
  /** After the export: allows calls again and restarts the runtime if it was running before. */
  resumeAfterExport(): AsyncResult<void>;
}

export function createLocalRuntimeManager(deps: LocalRuntimeManagerDeps): LocalRuntimeManager {
  const runtime = createLocalRuntime(deps);
  const idleUnloadMs = deps.idleUnloadMs ?? 15 * 60_000;
  const drainTimeoutMs = deps.drainTimeoutMs ?? 30_000;
  const listeners = new Set<(status: LocalRuntimeStatus) => void>();
  let active = 0;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  let paused = false;
  let runningBeforePause = false;
  const drained = new Set<() => void>();
  /** A switch to another model in progress: later calls wait for it. */
  let switching: Promise<void> | undefined;

  const status = (): LocalRuntimeStatus => {
    const base = runtime.status();
    return paused && base.state !== 'running' && base.state !== 'stopping'
      ? { ...base, state: 'paused' }
      : base;
  };
  const notify = () => {
    const current = status();
    for (const listener of listeners) listener(current);
  };
  runtime.onStatus(notify);

  const clearIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = undefined;
  };
  const scheduleIdle = () => {
    clearIdle();
    if (idleUnloadMs <= 0 || active > 0) return;
    idleTimer = setTimeout(() => {
      idleTimer = undefined;
      if (active > 0 || runtime.status().state !== 'running') return;
      deps.log?.({ type: 'idle_unload', idleMs: idleUnloadMs });
      void runtime.stop();
    }, idleUnloadMs);
    // A pending unload must not keep the process alive at quit.
    (idleTimer as { unref?: () => void }).unref?.();
  };
  const release = () => {
    active -= 1;
    if (active > 0) return;
    for (const resolve of drained) resolve();
    drained.clear();
    scheduleIdle();
  };
  /** Until no call is in flight (a model switch never cuts one short). */
  const waitForIdle = () =>
    active === 0 ? Promise.resolve() : new Promise<void>((resolve) => drained.add(resolve));
  const waitForDrain = () =>
    active === 0
      ? Promise.resolve()
      : new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, drainTimeoutMs);
          drained.add(() => {
            clearTimeout(timer);
            resolve();
          });
        });

  return {
    ...runtime,
    tier: deps.tier,
    status,
    async start(options = {}) {
      if (paused) return err(LocalRuntimeUnavailable({ state: 'paused' }));
      const started = await runtime.start(options);
      if (started.ok) scheduleIdle();
      return started;
    },
    async stop() {
      clearIdle();
      return runtime.stop();
    },
    async acquire(options = {}) {
      if (paused) return err(LocalRuntimeUnavailable({ state: 'paused' }));
      while (switching) await switching;
      const serving = runtime.servedModel();
      const wanted = options.model;
      if (wanted && serving && wanted !== serving && (await runtime.canServe(wanted))) {
        deps.log?.({ type: 'model_switch', from: serving, to: wanted });
        switching = (async () => {
          await waitForIdle();
          await runtime.stop();
        })().finally(() => {
          switching = undefined;
        });
        await switching;
        if (paused) return err(LocalRuntimeUnavailable({ state: 'paused' }));
      }
      active += 1;
      clearIdle();
      const started = await runtime.start(options);
      if (!started.ok || paused) {
        release();
        return started.ok ? err(LocalRuntimeUnavailable({ state: 'paused' })) : started;
      }
      let held = true;
      return ok({
        endpoint: started.value,
        release() {
          if (!held) return;
          held = false;
          release();
        },
      });
    },
    async stopForExport() {
      if (paused) return ok(undefined);
      paused = true;
      runningBeforePause = runtime.status().state === 'running';
      clearIdle();
      deps.log?.({ type: 'export_pause' });
      notify();
      await waitForDrain();
      const stopped = await runtime.stop();
      // The supervisor reports 'installed' after the stop; listeners should see 'paused'.
      notify();
      return stopped;
    },
    async resumeAfterExport() {
      if (!paused) return ok(undefined);
      paused = false;
      deps.log?.({ type: 'export_resume' });
      notify();
      if (!runningBeforePause) return ok(undefined);
      const started = await runtime.start();
      if (started.ok) scheduleIdle();
      return started.ok ? ok(undefined) : started;
    },
    onStatus(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
