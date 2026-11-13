// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A sliding window. `retryAfter` is whole seconds, at least 1. */
export function createRateLimiter(now: () => number) {
  const buckets = new Map<string, number[]>();

  function hit(
    key: string,
    limit: number,
    windowMs: number,
  ): { readonly ok: true } | { readonly ok: false; readonly retryAfter: number } {
    const at = now();
    const recent = (buckets.get(key) ?? []).filter((seen) => at - seen < windowMs);
    if (recent.length >= limit) {
      const oldest = recent[0] ?? at;
      buckets.set(key, recent);
      return { ok: false, retryAfter: Math.max(1, Math.ceil((windowMs - (at - oldest)) / 1000)) };
    }
    recent.push(at);
    buckets.set(key, recent);
    return { ok: true };
  }

  return { hit };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
