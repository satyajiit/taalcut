// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Cancellation inside the listening's long work (EAR1-R1).
 *
 * - **Checkpoints.** An abort only lands when the event loop runs, and the DSP is long synchronous loops, so the
 *   stages yield at checkpoints: between steps, and every few thousand frames of a spectrogram
 *   (dsp/abortable-runner.ts). Code that returns a Result asks `yieldAborted` and returns core.cancelled itself.
 *   Plain DSP code (which returns values, not Results) calls `checkpoint`, which unwinds with the signal's reason as
 *   `AbortSignal.throwIfAborted` does; `unwindOnAbort` at the analysis's edge turns that back into core.cancelled.
 *   Only an aborted signal's unwinding is caught there: any other throw is a bug and stays one.
 * - **Shared work.** A promise several callers wait on (a title set, AST's labels, CLAP's tokenizer) runs under its
 *   own controller, aborted only once every caller waiting on it has left; each caller races its own signal.
 */
import { CancelledError, err, type AsyncResult, type Result } from '@taalcut/core';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Lets a pending abort land, then says whether the signal is aborted. */
export async function yieldAborted(signal?: AbortSignal): Promise<boolean> {
  if (!signal) return false;
  await tick();
  return signal.aborted;
}

/** Lets a pending abort land, then unwinds if the signal is aborted (caught by `unwindOnAbort`). */
export async function checkpoint(signal?: AbortSignal): Promise<void> {
  if (!signal) return;
  await tick();
  signal.throwIfAborted();
}

/** Runs work whose DSP may unwind at a checkpoint: an aborted signal's unwinding is core.cancelled. */
export async function unwindOnAbort<T>(
  signal: AbortSignal | undefined,
  work: () => AsyncResult<T>,
): AsyncResult<T> {
  try {
    return await work();
  } catch (cause) {
    if (signal?.aborted) return err(CancelledError());
    throw cause;
  }
}

/** The result, or core.cancelled as soon as `signal` aborts (the work itself goes on for its other waiters). */
export function raceAbort<T>(pending: Promise<Result<T>>, signal?: AbortSignal): AsyncResult<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.resolve(err(CancelledError()));
  return new Promise((resolve) => {
    const onAbort = () => resolve(err(CancelledError()));
    signal.addEventListener('abort', onAbort, { once: true });
    void pending.then((result) => {
      signal.removeEventListener('abort', onAbort);
      resolve(result);
    });
  });
}

/** Work several callers share: its own controller aborts only when every caller that joined has left. */
export interface SharedWork<T> {
  /** Waits for the work under the caller's own signal. */
  join(signal?: AbortSignal): AsyncResult<T>;
  /** Every caller left before it finished: the work was aborted, so a new caller starts it again. */
  readonly abandoned: boolean;
  readonly result: Promise<Result<T>>;
}

export function shareWork<T>(run: (signal: AbortSignal) => AsyncResult<T>): SharedWork<T> {
  const controller = new AbortController();
  const result = run(controller.signal);
  let waiting = 0;
  let settled = false;
  void result.then(() => (settled = true));
  return {
    result,
    get abandoned() {
      return controller.signal.aborted;
    },
    async join(signal) {
      if (signal?.aborted) return err(CancelledError());
      waiting++;
      const got = await raceAbort(result, signal);
      waiting--;
      if (signal?.aborted && waiting === 0 && !settled) controller.abort();
      return got;
    },
  };
}
