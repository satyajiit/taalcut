// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The mcp process's copy of the live sessions (bearer hash → session and level), from the gateway's `sessions`
 * stream: the whole set first, then after every change, so a revoke lands here at once. When the stream breaks
 * (the agent process restarting) the last set is kept and the stream is opened again with backoff; an expiry time
 * is still checked on every lookup.
 */
import type { Clock, McpLevel, McpSessionId } from '@taalcut/core';
import { sameHash } from './bearer';

export interface CachedSession {
  readonly sessionId: McpSessionId;
  readonly level: McpLevel;
}

export interface GatewaySessionsSnapshot {
  readonly sessions: readonly {
    readonly id: McpSessionId;
    readonly tokenHash: string;
    readonly level: McpLevel;
    readonly expiresAt: number;
  }[];
}

export interface SessionCache {
  /** Resolves once the first set has arrived. */
  ready(): Promise<void>;
  /** Compares against every live hash (no early exit). */
  lookup(tokenHash: string): CachedSession | undefined;
  /** A session that was live and no longer is (revoked, expired, rotated away). */
  onGone(listener: (sessionId: McpSessionId) => void): () => void;
  stop(): void;
}

export interface SessionCacheDeps {
  /** The gateway's stream; it throws or ends when the agent process goes. */
  readonly subscribe: (signal: AbortSignal) => Promise<AsyncIterable<GatewaySessionsSnapshot>>;
  readonly clock: Clock;
  readonly log?: (message: string) => void;
  /** Waits between reconnects (default 250 ms, doubling to 5 s). */
  readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
}

const FIRST_RETRY_MS = 250;
const MAX_RETRY_MS = 5_000;

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

export function createSessionCache(deps: SessionCacheDeps): SessionCache {
  const log = deps.log ?? ((message: string) => console.warn(message));
  const wait = deps.wait ?? sleep;
  const controller = new AbortController();
  let current: GatewaySessionsSnapshot['sessions'] = [];
  const listeners = new Set<(sessionId: McpSessionId) => void>();
  let markReady: () => void = () => undefined;
  const readyPromise = new Promise<void>((resolve) => (markReady = resolve));

  const apply = (next: GatewaySessionsSnapshot): void => {
    const live = new Set(next.sessions.map((session) => `${session.id}:${session.tokenHash}`));
    const gone = current.filter((session) => !live.has(`${session.id}:${session.tokenHash}`));
    current = next.sessions;
    markReady();
    for (const session of gone) for (const listener of [...listeners]) listener(session.id);
  };

  void (async () => {
    let delay = FIRST_RETRY_MS;
    while (!controller.signal.aborted) {
      try {
        for await (const snapshot of await deps.subscribe(controller.signal)) {
          apply(snapshot);
          delay = FIRST_RETRY_MS;
        }
      } catch (cause) {
        if (!controller.signal.aborted) log(`[mcp] session stream broke: ${String(cause)}`);
      }
      if (controller.signal.aborted) break;
      await wait(delay, controller.signal);
      delay = Math.min(MAX_RETRY_MS, delay * 2);
    }
  })();

  return {
    ready: () => readyPromise,
    lookup(tokenHash) {
      const now = deps.clock.now();
      let found: CachedSession | undefined;
      for (const session of current) {
        const match = sameHash(session.tokenHash, tokenHash);
        if (match && found === undefined && session.expiresAt > now) {
          found = { sessionId: session.id, level: session.level };
        }
      }
      return found;
    },
    onGone(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => controller.abort(),
  };
}
