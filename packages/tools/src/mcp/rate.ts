// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Per-session request limits (MCP_LIMITS): requests in a sliding minute and calls running at once. A refused
 * request gets 429 with Retry-After, before its body is read.
 */
import type { Clock, McpSessionId } from '@taalcut/core';
import type { McpLimits } from './limits';

export type Admission =
  { readonly ok: true; release(): void } | { readonly ok: false; readonly retryAfterSeconds: number };

export interface RateLimiter {
  admit(sessionId: McpSessionId): Admission;
}

const MINUTE_MS = 60_000;

export function createRateLimiter(
  clock: Clock,
  limits: Pick<McpLimits, 'requestsPerMinute' | 'maxConcurrentCalls'>,
): RateLimiter {
  const recent = new Map<string, number[]>();
  const running = new Map<string, number>();
  return {
    admit(sessionId) {
      const now = clock.now();
      const times = (recent.get(sessionId) ?? []).filter((at) => now - at < MINUTE_MS);
      const busy = running.get(sessionId) ?? 0;
      if (times.length >= limits.requestsPerMinute) {
        recent.set(sessionId, times);
        const oldest = times[0] ?? now;
        return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + MINUTE_MS - now) / 1000)) };
      }
      if (busy >= limits.maxConcurrentCalls) {
        recent.set(sessionId, times);
        return { ok: false, retryAfterSeconds: 1 };
      }
      times.push(now);
      recent.set(sessionId, times);
      running.set(sessionId, busy + 1);
      let released = false;
      return {
        ok: true,
        release() {
          if (released) return;
          released = true;
          const left = (running.get(sessionId) ?? 1) - 1;
          if (left <= 0) running.delete(sessionId);
          else running.set(sessionId, left);
        },
      };
    },
  };
}
