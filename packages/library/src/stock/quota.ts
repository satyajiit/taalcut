// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Token buckets at the providers' published search limits: Pexels 200/hour,
 * Freesound 60/minute. The clock is injected. A response of
 * X-Ratelimit-Remaining: 0 empties the bucket until X-Ratelimit-Reset (unix
 * seconds) when that time is still ahead.
 */
import type { StockProviderId } from '@taalcut/core';
import { headerValue } from './stock-provider';

const LIMITS: Record<StockProviderId, { readonly capacity: number; readonly windowMs: number }> = {
  pexels: { capacity: 200, windowMs: 60 * 60 * 1000 },
  freesound: { capacity: 60, windowMs: 60 * 1000 },
};

interface Bucket {
  tokens: number;
  updatedAt: number;
  blockedUntil: number;
}

export interface StockQuota {
  /** False when the bucket is empty: the caller must not hit the network. */
  tryTake(provider: StockProviderId, now: number): { ok: true } | { ok: false; retryAfterSeconds: number };
  observe(provider: StockProviderId, headers: Readonly<Record<string, string>>, now: number): void;
}

function retrySeconds(ms: number): number {
  return Math.max(1, Math.ceil(ms / 1000));
}

export function createStockQuota(): StockQuota {
  const buckets = new Map<StockProviderId, Bucket>();
  const bucket = (provider: StockProviderId, now: number): Bucket => {
    const existing = buckets.get(provider);
    if (existing) return existing;
    const created = { tokens: LIMITS[provider].capacity, updatedAt: now, blockedUntil: 0 };
    buckets.set(provider, created);
    return created;
  };
  const refill = (provider: StockProviderId, state: Bucket, now: number) => {
    const { capacity, windowMs } = LIMITS[provider];
    const gained = ((now - state.updatedAt) * capacity) / windowMs;
    state.tokens = Math.min(capacity, state.tokens + Math.max(0, gained));
    state.updatedAt = now;
  };
  return {
    tryTake(provider, now) {
      const state = bucket(provider, now);
      if (state.blockedUntil > now)
        return { ok: false, retryAfterSeconds: retrySeconds(state.blockedUntil - now) };
      refill(provider, state, now);
      if (state.tokens < 1) {
        const perToken = LIMITS[provider].windowMs / LIMITS[provider].capacity;
        return { ok: false, retryAfterSeconds: retrySeconds(perToken) };
      }
      state.tokens -= 1;
      return { ok: true };
    },
    observe(provider, headers, now) {
      const remaining = headerValue(headers, 'x-ratelimit-remaining');
      if (remaining !== '0') return;
      const state = bucket(provider, now);
      state.tokens = 0;
      state.updatedAt = now;
      const reset = Number(headerValue(headers, 'x-ratelimit-reset'));
      if (Number.isFinite(reset) && reset * 1000 > now) state.blockedUntil = reset * 1000;
    },
  };
}
