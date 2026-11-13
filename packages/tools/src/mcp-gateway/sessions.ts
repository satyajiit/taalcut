// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The gateway's view of the MCP sessions (P3-V4). The records live in core's MCP_SESSIONS_SETTING and change only
 * through MCP_COMMANDS (commands.ts), which write them in the command's unit of work; this store re-reads them
 * after each of those commits. Last-used times change on every request, so they live in their own setting,
 * written only here and at most once a minute per session: a touch can never overwrite a revoke that a command
 * is committing at the same moment.
 */
import {
  createSerialQueue,
  defineSetting,
  MCP_SESSION_IDLE_EXPIRY_MS,
  MCP_SESSIONS_SETTING,
  ok,
  type AsyncResult,
  type Clock,
  type McpSessionId,
  type McpSessionRecord,
  type SettingsStore,
} from '@taalcut/core';
import { z } from 'zod';

/** sessionId → epoch ms of its last request. */
export const MCP_LAST_USED_SETTING = defineSetting(
  'mcp.lastUsed',
  z.record(z.string(), z.int().nonnegative()),
  {},
);

/** A session used within this long reads as active, otherwise idle. */
export const MCP_ACTIVE_WINDOW_MS = 10 * 60_000;
/** Last-used times are persisted, and announced, at most this often per session. */
export const MCP_TOUCH_PERSIST_MS = 60_000;

export type McpSessionState = 'active' | 'idle' | 'revoked' | 'expired';

export interface McpSessionStore {
  /** Re-reads the records and last-used times (at start and after every MCP command). */
  load(): AsyncResult<void>;
  /** Every record, with its last-used time merged in, newest first. */
  records(): readonly McpSessionRecord[];
  get(id: McpSessionId): McpSessionRecord | undefined;
  /** The session whose bearer hashes to `tokenHash`, revoked or not. */
  byTokenHash(tokenHash: string): McpSessionRecord | undefined;
  state(record: McpSessionRecord): McpSessionState;
  /** When a live session stops working unless used again. */
  expiresAt(record: McpSessionRecord): number;
  /** Notes a request; persists and announces at most once a minute per session. */
  touch(id: McpSessionId): void;
  /** After a load, and after an announced touch. */
  onChange(listener: () => void): () => void;
  /** Waits for pending last-used writes (tests, shutdown). */
  flush(): Promise<void>;
}

export interface McpSessionStoreDeps {
  readonly settings: SettingsStore;
  readonly clock: Clock;
  readonly log?: (message: string) => void;
}

export function createMcpSessionStore(deps: McpSessionStoreDeps): McpSessionStore {
  const log = deps.log ?? ((message: string) => console.warn(message));
  let stored: readonly McpSessionRecord[] = [];
  const lastUsed = new Map<string, number>();
  const announced = new Map<string, number>();
  const listeners = new Set<() => void>();
  /** Last-used writes in order. Settings answer with a Result, and a failed save is logged. */
  const writes = createSerialQueue();

  const notify = (): void => {
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (cause) {
        log(`[mcp] session listener failed: ${String(cause)}`);
      }
    }
  };
  const merged = (record: McpSessionRecord): McpSessionRecord => {
    const used = Math.max(record.lastUsedAt ?? 0, lastUsed.get(record.id) ?? 0);
    return used > 0 ? { ...record, lastUsedAt: used } : record;
  };
  const expiresAt = (record: McpSessionRecord): number =>
    (merged(record).lastUsedAt ?? record.createdAt) + MCP_SESSION_IDLE_EXPIRY_MS;

  const persist = (): void => {
    const snapshot = Object.fromEntries(lastUsed);
    void writes.run(async () => {
      const saved = await deps.settings.set(MCP_LAST_USED_SETTING, snapshot);
      if (!saved.ok) log(`[mcp] last-used times not saved: ${saved.error.code}`);
    });
  };

  return {
    async load() {
      const records = await deps.settings.get(MCP_SESSIONS_SETTING);
      if (!records.ok) return records;
      const used = await deps.settings.get(MCP_LAST_USED_SETTING);
      if (!used.ok) return used;
      for (const [id, at] of Object.entries(used.value)) {
        if (at > (lastUsed.get(id) ?? 0)) lastUsed.set(id, at);
      }
      stored = [...records.value].sort((a, b) => b.createdAt - a.createdAt);
      notify();
      return ok(undefined);
    },
    records: () => stored.map(merged),
    get(id) {
      const record = stored.find((candidate) => candidate.id === id);
      return record ? merged(record) : undefined;
    },
    byTokenHash(tokenHash) {
      const record = stored.find((candidate) => candidate.tokenHash === tokenHash);
      return record ? merged(record) : undefined;
    },
    state(record) {
      if (record.revokedAt !== null) return 'revoked';
      const now = deps.clock.now();
      if (expiresAt(record) <= now) return 'expired';
      const used = merged(record).lastUsedAt;
      return used !== null && now - used < MCP_ACTIVE_WINDOW_MS ? 'active' : 'idle';
    },
    expiresAt,
    touch(id) {
      const now = deps.clock.now();
      lastUsed.set(id, now);
      const last = announced.get(id);
      if (last !== undefined && now - last < MCP_TOUCH_PERSIST_MS) return;
      announced.set(id, now);
      persist();
      notify();
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    flush: () => writes.settled(),
  };
}
