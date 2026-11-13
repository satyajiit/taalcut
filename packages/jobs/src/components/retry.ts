// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Retry timing for downloads: exponential backoff with jitter, and an abortable sleep. */

/**
 * Same shape as core's ToolRetryPolicy. `maxAttempts` counts consecutive
 * failed attempts per mirror; an attempt that received bytes resets the count,
 * so a slow, flaky link keeps going as long as it makes progress.
 */
export interface RetryPolicy {
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  readonly maxDelayMs?: number;
  readonly factor?: number;
}

export const DEFAULT_DOWNLOAD_RETRY: RetryPolicy = {
  maxAttempts: 5,
  initialDelayMs: 1_000,
  maxDelayMs: 30_000,
  factor: 2,
};

/** Delay before retry `failures` (1-based), with ±20% jitter, at least `minDelayMs` (Retry-After). */
export function backoffDelay(
  policy: RetryPolicy,
  failures: number,
  random: () => number = Math.random,
  minDelayMs = 0,
): number {
  const max = policy.maxDelayMs ?? 30_000;
  const base = Math.min(max, policy.initialDelayMs * (policy.factor ?? 2) ** Math.max(0, failures - 1));
  const jittered = base * (0.8 + 0.4 * random());
  return Math.round(Math.min(max, Math.max(jittered, minDelayMs)));
}

/** Retry-After as milliseconds: delta-seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  if (/^\d+$/.test(value.trim())) return Number(value.trim()) * 1000;
  const date = Date.parse(value);
  return Number.isNaN(date) ? undefined : Math.max(0, date - now);
}

export type Sleep = (ms: number, signal?: AbortSignal) => Promise<void>;

/** Resolves after `ms`, or rejects with the signal's reason when it aborts first. */
export const sleep: Sleep = (ms, signal) =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
