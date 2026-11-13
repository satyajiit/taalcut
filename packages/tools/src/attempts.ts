// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Timeouts, cancellation and retries for one tool call. Each attempt gets its
 * own AbortSignal, aborted on timeout or when the caller cancels. The call
 * settles at the deadline even if the tool ignores its signal.
 *
 * Attempts never overlap: after a timeout, the next attempt starts only once
 * the timed-out run() has returned. A run() that keeps going past a grace
 * period is not retried. Timeouts are retried only when `retryTimeouts` is
 * set (read tools): for a tool that changes state, a timed-out attempt may
 * already have had its effect.
 */
import {
  CancelledError,
  err,
  isTaalcutError,
  TimeoutError,
  type AsyncResult,
  type Result,
  type TaalcutError,
  type ToolRetryPolicy,
} from '@taalcut/core';

const DEFAULT_MAX_DELAY_MS = 30_000;
const DEFAULT_FACTOR = 2;
const MAX_SETTLE_GRACE_MS = 5_000;

export interface AttemptOptions {
  readonly timeoutMs: number;
  readonly retry: ToolRetryPolicy;
  /** The caller's signal (stop button, run cancelled). */
  readonly signal?: AbortSignal;
  /** In [0, 1). Injected so tests are deterministic. */
  readonly random: () => number;
  /** Retry `core.timeout`. Only for tools with no side effects. */
  readonly retryTimeouts: boolean;
  /** How long a timed-out run() may take to stop before a retry is given up. Default: timeoutMs, at most 5 s. */
  readonly settleGraceMs?: number;
  /** Turns a throw from the tool into an error. */
  readonly onThrow: (cause: unknown) => TaalcutError;
  readonly onRetry: (failedAttempt: number, delayMs: number, error: TaalcutError) => void;
}

export interface AttemptsOutcome<T> {
  readonly result: Result<T>;
  readonly attempts: number;
  /**
   * The last attempt's run() had not returned when the call gave up (timeout
   * or cancel), so whatever it does still happens: its effect is unknown.
   */
  readonly unsettled: boolean;
}

interface Attempt<T> {
  readonly result: Result<T>;
  /** True when the deadline or the caller stopped the attempt before run() returned. */
  readonly stopped: boolean;
  /** Settles when run() returns, whoever won the race. */
  readonly done: Promise<unknown>;
}

export async function runWithRetries<T>(
  invoke: (signal: AbortSignal, attempt: number) => AsyncResult<T>,
  options: AttemptOptions,
): Promise<AttemptsOutcome<T>> {
  const grace = options.settleGraceMs ?? Math.min(options.timeoutMs, MAX_SETTLE_GRACE_MS);
  for (let attempt = 1; ; attempt++) {
    const { result, stopped, done } = await runOnce(invoke, attempt, options);
    const give = (r: Result<T>, unsettled: boolean) => ({ result: r, attempts: attempt, unsettled });
    if (result.ok || !shouldRetry(result.error, attempt, options)) return give(result, stopped);
    // Never two attempts at once: wait for the stopped one to return first.
    if (stopped && !(await settles(done, grace, options.signal))) {
      return give(options.signal?.aborted ? err(CancelledError()) : result, true);
    }
    const delayMs = backoffDelay(options.retry, attempt, options.random);
    options.onRetry(attempt, delayMs, result.error);
    if (!(await sleep(delayMs, options.signal))) return give(err(CancelledError()), false);
  }
}

function shouldRetry(error: TaalcutError, attempt: number, options: AttemptOptions): boolean {
  return (
    error.retryable &&
    attempt < options.retry.maxAttempts &&
    !options.signal?.aborted &&
    !CancelledError.is(error) &&
    (options.retryTimeouts || !TimeoutError.is(error))
  );
}

/** Delay before the retry that follows `failedAttempt` (1-based): exponential, capped, with jitter in [50%, 100%]. */
export function backoffDelay(retry: ToolRetryPolicy, failedAttempt: number, random: () => number): number {
  const factor = retry.factor ?? DEFAULT_FACTOR;
  const cap = retry.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const base = Math.min(cap, retry.initialDelayMs * factor ** (failedAttempt - 1));
  return Math.round(base * (0.5 + random() * 0.5));
}

async function runOnce<T>(
  invoke: (signal: AbortSignal, attempt: number) => AsyncResult<T>,
  attempt: number,
  options: AttemptOptions,
): Promise<Attempt<T>> {
  const parent = options.signal;
  if (parent?.aborted) return { result: err(CancelledError()), stopped: false, done: Promise.resolve() };
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onParentAbort: (() => void) | undefined;
  // Settles first on timeout or cancel; the tool's own promise loses the race.
  const stopped = new Promise<Result<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve(err(TimeoutError({ ms: options.timeoutMs })));
      controller.abort(new DOMException('Tool timed out', 'TimeoutError'));
    }, options.timeoutMs);
    onParentAbort = () => {
      resolve(err(CancelledError()));
      controller.abort(parent?.reason);
    };
    parent?.addEventListener('abort', onParentAbort, { once: true });
  });
  const running = (async (): AsyncResult<T> => {
    try {
      const result = await invoke(controller.signal, attempt);
      if (result && typeof result === 'object' && typeof result.ok === 'boolean') return result;
      return err(options.onThrow(new TypeError('run() must return a Result (ok(...) or err(...))')));
    } catch (cause) {
      return err(isTaalcutError(cause) ? cause : options.onThrow(cause));
    }
  })();
  try {
    const winner = await Promise.race([
      running.then((result) => ({ result, stopped: false })),
      stopped.then((result) => ({ result, stopped: true })),
    ]);
    return { ...winner, done: running };
  } finally {
    clearTimeout(timer);
    if (onParentAbort) parent?.removeEventListener('abort', onParentAbort);
  }
}

/** True if `done` settles within `ms`; false on the deadline or as soon as `signal` aborts. */
async function settles(done: Promise<unknown>, ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    return await Promise.race([done.then(() => true), sleep(ms, controller.signal).then(() => false)]);
  } finally {
    controller.abort();
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Resolves true after `ms`, or false as soon as `signal` aborts. */
function sleep(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve(false);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve(true);
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
