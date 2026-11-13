// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The MCP_SESSIONS_SETTING rows as the session writes use them (P3-V4): read, write (inside a command's unit of
 * work when there is one), whether a row is live, one row changed, and pruning to MAX_STORED rows.
 */
import {
  err,
  MCP_SESSIONS_SETTING,
  ok,
  ValidationError,
  type AsyncResult,
  type CommandContext,
  type McpSessionId,
  type McpSessionRecord,
  type SettingsStore,
} from '@taalcut/core';
import type { McpSessionStore } from './sessions';

/** MCP_SESSIONS_SETTING keeps at most this many rows; the oldest revoked or expired ones go first. */
const MAX_STORED = 64;

export type Records = readonly McpSessionRecord[];

export interface SessionRecordsDeps {
  readonly settings: SettingsStore;
  readonly sessions: Pick<McpSessionStore, 'state'>;
}

export function createSessionRecords(deps: SessionRecordsDeps) {
  const read = async (): AsyncResult<Records> => deps.settings.get(MCP_SESSIONS_SETTING);
  const write = (records: Records, context?: CommandContext) =>
    deps.settings.set(MCP_SESSIONS_SETTING, [...records], context);
  const live = (record: McpSessionRecord): boolean => {
    const state = deps.sessions.state(record);
    return state !== 'revoked' && state !== 'expired';
  };

  /** Applies `change` to one live session; the result and inverse come from the record before. */
  const update = async <R>(
    sessionId: McpSessionId,
    context: CommandContext | undefined,
    change: (record: McpSessionRecord) => McpSessionRecord,
    outcome: (before: McpSessionRecord) => R,
  ): AsyncResult<R> => {
    const records = await read();
    if (!records.ok) return records;
    const before = records.value.find((record) => record.id === sessionId);
    if (!before || before.revokedAt !== null)
      return err(ValidationError({ field: 'sessionId' }, { detail: 'no live session with this id' }));
    const saved = await write(
      records.value.map((record) => (record.id === sessionId ? change(record) : record)),
      context,
    );
    return saved.ok ? ok(outcome(before)) : saved;
  };

  /** Keeps every live session and the newest dead ones, at most MAX_STORED rows. */
  const pruned = (records: Records): McpSessionRecord[] => {
    const alive = records.filter(live);
    const dead = records.filter((record) => !live(record)).sort((a, b) => b.createdAt - a.createdAt);
    return [...alive, ...dead.slice(0, Math.max(0, MAX_STORED - alive.length))];
  };

  return { read, write, live, update, pruned };
}

export type SessionRecords = ReturnType<typeof createSessionRecords>;
