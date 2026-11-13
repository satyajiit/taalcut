// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The shot-boundary model in a process of its own (IX2-S2, S10), behind the same `ShotBoundaryModel` the jobs
 * thread's model had, so `vision.shots` doesn't change. How the process starts and talks is the caller's (`open`):
 * the ONNX model's Electron utility process (remote-model.ts) or the mac helper's Core ML `shots` service
 * (coreml-model.ts). Either way:
 *
 * - **Lazy.** Loading checks the component is installed and hands out a lease; the process starts on the
 *   lease's first window, so a job that never gets that far starts nothing. An `eager` pool (Core ML) starts it
 *   at the load instead and fails the load when the model won't open, so the caller can choose another model.
 * - **One process, shared.** Every lease (every shots job) sends to the same running process, which runs their
 *   windows in turn. After `idleMs` without a window in flight the client releases it and the process ends;
 *   the next window starts another.
 * - **Failure.** A process that fails to start or is lost mid-run fails the window, and every later window of
 *   the leases that saw it, as `vision.shot_model_failed`: the job falls back to scdet (detect-shots.ts). The
 *   next job's lease may start a process again.
 * - **Cancel.** A cancelled window stops waiting at once, even while its process starts; nothing more is sent.
 */
import {
  CancelledError,
  err,
  ok,
  raceAbort,
  type AsyncResult,
  type ComputeBackend,
  type TaalcutError,
} from '@taalcut/core';
import { ShotModelFailed } from '../errors';
import type { ModelSession, ModelTimers } from './model-session';
import type { ShotBoundaryModel } from './transnet';
import type { WindowOutput } from './windows';

export interface ModelPoolOptions {
  /** The component the model comes from: the leases' id. */
  readonly component: string;
  /** The installed component's folder, or null (looked up again at every load). */
  readonly modelDir: () => Promise<string | null>;
  /** Starts a process over `modelDir` and gives its session (which may still be opening the model). */
  readonly open: (modelDir: string) => AsyncResult<ModelSession>;
  /** The process ends after this long without a window in flight. */
  readonly idleMs: number;
  /** The provider a lease reports before its process has said which one it opened on. */
  readonly expectedBackend: ComputeBackend;
  /** Start the process, and wait for its model, at the load (default: at the first window). */
  readonly eager?: boolean;
  readonly timers: ModelTimers;
}

export interface ShotModelPool {
  /** `vision.shots`' model: a lease on the shared process. */
  load(signal?: AbortSignal): AsyncResult<ShotBoundaryModel>;
  /** Releases the running process now (an eval's end; the app relies on the idle exit). */
  close(): Promise<void>;
}

export const shotModelFailed = (detail: string) => ShotModelFailed(undefined, { detail });

/** One process: its session once it started, and the provider it said it opened on. */
interface Running {
  readonly session: Promise<ModelSession | TaalcutError>;
  live?: ModelSession;
  backend?: ComputeBackend;
}

/** The one running process every lease shares, started on demand and released when idle. */
class ModelPool {
  private current: Running | undefined;
  private idle: unknown;

  constructor(private readonly options: ModelPoolOptions) {}

  get backend(): ComputeBackend {
    return this.current?.backend ?? this.options.expectedBackend;
  }

  /** The running process's session, started from `modelDir` when there is none; or why there is none. */
  async session(modelDir: string, signal?: AbortSignal): Promise<ModelSession | TaalcutError | undefined> {
    this.options.timers.clearTimeout(this.idle);
    this.current ??= this.start(modelDir);
    const session = await raceAbort(this.current.session.then(ok), signal);
    return session.ok ? session.value : undefined;
  }

  /** After an answer: with nothing in flight, the process ends unless a window comes within `idleMs`. */
  settleIdle(session: ModelSession): void {
    if (session.inFlight > 0) return;
    const { timers, idleMs } = this.options;
    timers.clearTimeout(this.idle);
    this.idle = timers.setTimeout(() => {
      if (session.inFlight > 0) return;
      if (this.current?.live === session) this.current = undefined;
      void session.release();
    }, idleMs);
  }

  async close(): Promise<void> {
    this.options.timers.clearTimeout(this.idle);
    const running = this.current;
    this.current = undefined;
    const session = await running?.session;
    if (session && 'ask' in session) await session.release();
  }

  private start(modelDir: string): Running {
    const running: Running = {
      session: this.options
        .open(modelDir)
        .catch((cause: unknown) => err(shotModelFailed(`the model process didn't start: ${String(cause)}`)))
        .then((session) =>
          session.ok ? this.adopt(running, session.value) : this.lost(running, session.error),
        ),
    };
    return running;
  }

  private adopt(running: Running, session: ModelSession): ModelSession {
    running.live = session;
    session.onEnd(() => this.forget(running));
    void session.opened.then((ready) => {
      if (!ready.ok) return;
      running.backend = ready.value.backend;
      // A process whose first window was cancelled while it started still ends when idle.
      this.settleIdle(session);
    });
    return session;
  }

  private lost(running: Running, why: TaalcutError): TaalcutError {
    this.forget(running);
    return why.code === 'vision.shot_model_failed'
      ? why
      : shotModelFailed(`${why.code}: ${why.detail ?? ''}`);
  }

  private forget(running: Running): void {
    if (this.current === running) this.current = undefined;
  }
}

/** A job's hold on the pool: after a window fails with the model failing, every later one fails too. */
function lease(pool: ModelPool, component: string, modelDir: string): ShotBoundaryModel {
  let failure: TaalcutError | undefined;
  return {
    id: component,
    get backend() {
      return pool.backend;
    },
    async predict(window: Float32Array, signal?: AbortSignal): AsyncResult<WindowOutput> {
      if (signal?.aborted) return err(CancelledError());
      if (failure) return err(failure);
      const session = await pool.session(modelDir, signal);
      if (session === undefined) return err(CancelledError());
      if (!('ask' in session)) return err((failure = session));
      const out = await session.ask(window, signal);
      if (!out.ok && out.error.code === 'vision.shot_model_failed') failure = out.error;
      pool.settleIdle(session);
      return out;
    },
    // A lease holds nothing of its own: the process ends by its idle exit.
    release: async () => undefined,
  };
}

/** Its process started and its model open, or why not (an eager load). */
async function opened(pool: ModelPool, modelDir: string, signal?: AbortSignal): AsyncResult<undefined> {
  const session = await pool.session(modelDir, signal);
  if (session === undefined) return err(CancelledError());
  if (!('ask' in session)) return err(session);
  const ready = await raceAbort(session.opened, signal);
  if (!ready.ok) return ready;
  pool.settleIdle(session);
  return ok(undefined);
}

export function shotModelPool(options: ModelPoolOptions): ShotModelPool {
  const pool = new ModelPool(options);
  return {
    async load(signal) {
      if (signal?.aborted) return err(CancelledError());
      const dir = await options.modelDir();
      if (dir === null) return err(shotModelFailed(`${options.component} is not installed`));
      if (options.eager) {
        const ready = await opened(pool, dir, signal);
        if (!ready.ok) return ready;
      }
      return ok(lease(pool, options.component, dir));
    },
    close: () => pool.close(),
  };
}
