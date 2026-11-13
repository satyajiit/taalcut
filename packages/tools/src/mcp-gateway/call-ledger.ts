// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the gateway remembers about calls while the agent process runs: the calls in flight per session (so a
 * revoke cancels them at once), how many calls each session made today (Settings' row), and the approvals it is
 * still waiting for. In memory only: after a restart the counts start again, and the run log keeps the truth.
 */
import type { Clock, McpSessionId } from '@taalcut/core';

export interface CallLedger {
  /** A controller for one call, aborted with the caller's signal and by abortSession. Call `end` when done. */
  begin(
    sessionId: McpSessionId,
    signal?: AbortSignal,
  ): { readonly signal: AbortSignal; abort(): void; end(): void };
  /** Cancels every call of the session (revoke, expiry). */
  abortSession(sessionId: McpSessionId): void;
  /** Counts a call against the session's local day. */
  counted(sessionId: McpSessionId): void;
  callsToday(sessionId: McpSessionId): number;
  /** The call (by the client's key) is waiting for this approval, as the runner knows it by `runKey`. */
  pending(sessionId: McpSessionId, callKey: string, approvalId: string, runKey: string): void;
  /** The runner's key of the call waiting under this client key, if one is. */
  waitingRunKey(sessionId: McpSessionId, callKey: string): string | undefined;
  /** The call finished, was declined or failed: no longer waiting. */
  settled(sessionId: McpSessionId, callKey: string): void;
  pendingApprovals(sessionId: McpSessionId): number;
  forget(sessionId: McpSessionId): void;
  onChange(listener: () => void): () => void;
}

interface Waiting {
  readonly approvalId: string;
  readonly runKey: string;
  readonly at: number;
}

/** A pending approval no call asked about for this long is no longer counted. */
const PENDING_TTL_MS = 24 * 60 * 60_000;

function localDay(at: number): string {
  const date = new Date(at);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function createCallLedger(clock: Clock): CallLedger {
  const inflight = new Map<string, Set<AbortController>>();
  const calls = new Map<string, { day: string; count: number }>();
  const waiting = new Map<string, Map<string, Waiting>>();
  const listeners = new Set<() => void>();
  const notify = (): void => {
    for (const listener of [...listeners]) listener();
  };

  return {
    begin(sessionId, signal) {
      const controller = new AbortController();
      const onAbort = (): void => controller.abort(signal?.reason);
      if (signal?.aborted) controller.abort(signal.reason);
      else signal?.addEventListener('abort', onAbort, { once: true });
      const set = inflight.get(sessionId) ?? new Set<AbortController>();
      set.add(controller);
      inflight.set(sessionId, set);
      return {
        signal: controller.signal,
        abort: () => controller.abort(),
        end() {
          signal?.removeEventListener('abort', onAbort);
          set.delete(controller);
          if (set.size === 0 && inflight.get(sessionId) === set) inflight.delete(sessionId);
        },
      };
    },
    abortSession(sessionId) {
      for (const controller of inflight.get(sessionId) ?? []) controller.abort();
      inflight.delete(sessionId);
    },
    counted(sessionId) {
      const day = localDay(clock.now());
      const current = calls.get(sessionId);
      calls.set(sessionId, { day, count: current?.day === day ? current.count + 1 : 1 });
      notify();
    },
    callsToday(sessionId) {
      const current = calls.get(sessionId);
      return current && current.day === localDay(clock.now()) ? current.count : 0;
    },
    pending(sessionId, callKey, approvalId, runKey) {
      const map = waiting.get(sessionId) ?? new Map<string, Waiting>();
      map.set(callKey, { approvalId, runKey, at: clock.now() });
      waiting.set(sessionId, map);
      notify();
    },
    waitingRunKey(sessionId, callKey) {
      const entry = waiting.get(sessionId)?.get(callKey);
      return entry && clock.now() - entry.at <= PENDING_TTL_MS ? entry.runKey : undefined;
    },
    settled(sessionId, callKey) {
      if (waiting.get(sessionId)?.delete(callKey)) notify();
    },
    pendingApprovals(sessionId) {
      const map = waiting.get(sessionId);
      if (!map) return 0;
      const now = clock.now();
      for (const [key, entry] of map) if (now - entry.at > PENDING_TTL_MS) map.delete(key);
      return map.size;
    },
    forget(sessionId) {
      calls.delete(sessionId);
      waiting.delete(sessionId);
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
