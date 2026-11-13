// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tool runs: one row per agent tool call, shown as tool-run cards and in the
 * trace (PRD 6.3). Input, output and error are redacted of secrets (P1-F5).
 */
import {
  err,
  newId,
  ok,
  type CommandId,
  type ConversationId,
  type MessageId,
  type Result,
  type RunId,
  type SideEffect,
  type ToolRunId,
} from '@taalcut/core';
import { asc, desc, eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { InvalidState } from '../errors';
import { toolRuns } from '../schema/chat';
import { redactSecrets } from '../secrets/redact';
import { attemptWrite, found, inTransaction, pageSize } from './shared';

export type ToolRun = typeof toolRuns.$inferSelect;

export interface ToolRunStart {
  readonly id?: ToolRunId;
  readonly runId?: RunId | null;
  readonly conversationId?: ConversationId | null;
  readonly messageId?: MessageId | null;
  readonly toolName: string;
  readonly toolVersion: string;
  readonly input: unknown;
  /** The tool's declared side effect, shown on its card. */
  readonly sideEffect?: SideEffect | null;
}

export interface ToolRunOutcome {
  readonly status: 'succeeded' | 'failed' | 'cancelled';
  readonly output?: unknown;
  /** A TaalcutError, as a plain object. */
  readonly error?: unknown;
  readonly commandId?: CommandId | null;
}

export interface ToolRunRepository {
  start(input: ToolRunStart): Result<ToolRun>;
  /** running → succeeded|failed|cancelled. InvalidState if it already finished. */
  finish(id: ToolRunId, outcome: ToolRunOutcome): Result<ToolRun>;
  get(id: ToolRunId): Result<ToolRun>;
  /** In start order. */
  listByRun(runId: RunId): ToolRun[];
  /** Newest first. */
  listByConversation(conversationId: ConversationId, options?: { limit?: number }): ToolRun[];
}

export function createToolRunRepository(db: LibraryDatabase): ToolRunRepository {
  const { orm } = db;
  const get = (id: ToolRunId) =>
    found(orm.select().from(toolRuns).where(eq(toolRuns.id, id)).get(), 'tool_run', id);
  return {
    start(input) {
      const row: ToolRun = {
        id: input.id ?? newId<'ToolRun'>(),
        runId: input.runId ?? null,
        conversationId: input.conversationId ?? null,
        messageId: input.messageId ?? null,
        toolName: input.toolName,
        toolVersion: input.toolVersion,
        status: 'running',
        input: redactSecrets(input.input ?? {}),
        output: null,
        error: null,
        commandId: null,
        startedAt: db.clock(),
        finishedAt: null,
        sideEffect: input.sideEffect ?? null,
      };
      return attemptWrite(db, 'tool_run', () => orm.insert(toolRuns).values(row).returning().get());
    },
    finish(id, outcome) {
      return inTransaction(db, 'tool_run', () => {
        const current = get(id);
        if (!current.ok) return current;
        if (current.value.status !== 'running') {
          return err(InvalidState({ entity: 'tool_run', state: current.value.status }));
        }
        const row = orm
          .update(toolRuns)
          .set({
            status: outcome.status,
            output: redactSecrets(outcome.output ?? null),
            error: redactSecrets(outcome.error ?? null),
            commandId: outcome.commandId ?? null,
            finishedAt: db.clock(),
          })
          .where(eq(toolRuns.id, id))
          .returning()
          .get();
        return ok(row!);
      });
    },
    get,
    listByRun: (runId) =>
      orm
        .select()
        .from(toolRuns)
        .where(eq(toolRuns.runId, runId))
        .orderBy(asc(toolRuns.startedAt), asc(toolRuns.id))
        .all(),
    listByConversation: (conversationId, options = {}) =>
      orm
        .select()
        .from(toolRuns)
        .where(eq(toolRuns.conversationId, conversationId))
        .orderBy(desc(toolRuns.startedAt), desc(toolRuns.id))
        .limit(pageSize(options.limit))
        .all(),
  };
}
