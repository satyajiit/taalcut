// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * 2025-11-25 protocol sessions (tools SPEC, "The HTTP surface"): an `MCP-Session-Id` minted on a 2025 `initialize`
 * and bound to the bearer's session. It is bookkeeping, never a credential: every request still carries the
 * bearer. An id that is unknown, bound to another session, ended by DELETE, or whose session was revoked answers
 * 404, as the 2025 spec says for a session the server has ended.
 */
import { randomBytes } from 'node:crypto';
import type { Clock, McpSessionId } from '@taalcut/core';

export type LegacyCheck = 'ok' | 'unknown';

export interface LegacySessions {
  mint(sessionId: McpSessionId): string;
  check(protocolSession: string, sessionId: McpSessionId): LegacyCheck;
  /** DELETE: false when the id wasn't live for this session. */
  end(protocolSession: string, sessionId: McpSessionId): boolean;
  /** The bearer's session is gone: every protocol session bound to it ends. */
  dropSession(sessionId: McpSessionId): void;
}

/** Protocol sessions unused this long are forgotten (the client re-initializes after a 404). */
const IDLE_MS = 24 * 60 * 60_000;
/** Per bearer session; the oldest is dropped beyond it. */
const MAX_PER_SESSION = 32;

export function createLegacySessions(clock: Clock): LegacySessions {
  const live = new Map<string, { sessionId: McpSessionId; usedAt: number }>();

  const sweep = (): void => {
    const now = clock.now();
    for (const [id, entry] of live) if (now - entry.usedAt > IDLE_MS) live.delete(id);
  };

  return {
    mint(sessionId) {
      sweep();
      const mine = [...live].filter(([, entry]) => entry.sessionId === sessionId);
      if (mine.length >= MAX_PER_SESSION) {
        const [oldest] = mine.sort((a, b) => a[1].usedAt - b[1].usedAt)[0] ?? [];
        if (oldest !== undefined) live.delete(oldest);
      }
      // 43 base64url characters: visible ASCII, as the spec requires of a session id.
      const id = randomBytes(32).toString('base64url');
      live.set(id, { sessionId, usedAt: clock.now() });
      return id;
    },
    check(protocolSession, sessionId) {
      sweep();
      const entry = live.get(protocolSession);
      if (!entry || entry.sessionId !== sessionId) return 'unknown';
      entry.usedAt = clock.now();
      return 'ok';
    },
    end(protocolSession, sessionId) {
      const entry = live.get(protocolSession);
      if (!entry || entry.sessionId !== sessionId) return false;
      live.delete(protocolSession);
      return true;
    },
    dropSession(sessionId) {
      for (const [id, entry] of live) if (entry.sessionId === sessionId) live.delete(id);
    },
  };
}
