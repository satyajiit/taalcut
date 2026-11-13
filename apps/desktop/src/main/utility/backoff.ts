// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Restart delays for crashed utility processes: 250 ms, 500 ms, 1 s, … capped at 30 s. */
export interface BackoffPolicy {
  /** Delay before the first restart. Keeps "restarted within 2 s" true for a one-off crash. */
  readonly initialMs: number;
  readonly factor: number;
  readonly maxMs: number;
  /** A process that ran this long before crashing starts again from initialMs. */
  readonly stableAfterMs: number;
}

export const DEFAULT_BACKOFF: BackoffPolicy = {
  initialMs: 250,
  factor: 2,
  maxMs: 30_000,
  stableAfterMs: 30_000,
};

/** Delay before restart number `attempt` (0-based) of a crash streak. */
export function backoffDelay(attempt: number, policy: BackoffPolicy = DEFAULT_BACKOFF): number {
  return Math.min(policy.maxMs, policy.initialMs * policy.factor ** Math.max(0, attempt));
}
