// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle tables: Command (the command bus audit log, PRD V2) and the agent's
 * append-only run log (PRD 7.2, "Durability"): agent_events plus one
 * agent_runs summary row per run.
 */
import {
  COMMAND_SOURCES,
  RUN_STATUSES,
  SIDE_EFFECTS,
  type CommandId,
  type ConversationId,
  type ProjectId,
  type RunId,
} from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { conversations, projects } from './chat';

/** applied → undone → redone → undone → … */
export const COMMAND_STATUSES = ['applied', 'undone', 'redone'] as const;
export type CommandStatus = (typeof COMMAND_STATUSES)[number];

export const commands = sqliteTable(
  'commands',
  {
    id: text('id').$type<CommandId>().primaryKey(),
    /** Null for app-wide commands (settings, theme). They share one sequence. */
    projectId: text('project_id')
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** 1, 2, 3… per project (or per the null scope), in commit order. */
    seq: integer('seq').notNull(),
    name: text('name').notNull(),
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
    /** What undo dispatches. Null when the command can't be undone. */
    inverse: text('inverse', { mode: 'json' }).$type<unknown>(),
    source: text('source', { enum: COMMAND_SOURCES }).notNull(),
    /** Who dispatched it, e.g. 'user', 'agent:<runId>', 'mcp:<client>'. */
    actor: text('actor').notNull(),
    sideEffect: text('side_effect', { enum: SIDE_EFFECTS }).notNull(),
    status: text('status', { enum: COMMAND_STATUSES }).notNull().default('applied'),
    createdAt: integer('created_at').notNull(),
    undoneAt: integer('undone_at'),
    redoneAt: integer('redone_at'),
    /** Unique across the log when set: a repeated dispatch with this key returns the stored result. */
    idempotencyKey: text('idempotency_key'),
    /** The handler's result, as JSON. */
    result: text('result', { mode: 'json' }).$type<unknown>(),
    /** EDT1: the history step it joined; undo and redo take a group whole. Null on its own. */
    groupId: text('group_id'),
  },
  (t) => [
    uniqueIndex('commands_scope_seq_uq').on(sql`coalesce(${t.projectId}, '')`, t.seq),
    index('commands_project_seq_idx').on(t.projectId, t.seq),
    uniqueIndex('commands_idempotency_key_uq')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
  ],
);

export const agentEvents = sqliteTable(
  'agent_events',
  {
    runId: text('run_id').$type<RunId>().notNull(),
    /** 1, 2, 3… per run. Replay reads events in this order. */
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.seq] })],
);

/** One row per run, updated in the same transaction as its events. */
export const agentRuns = sqliteTable(
  'agent_runs',
  {
    runId: text('run_id').$type<RunId>().primaryKey(),
    conversationId: text('conversation_id')
      .$type<ConversationId>()
      .references(() => conversations.id, { onDelete: 'set null' }),
    status: text('status', { enum: RUN_STATUSES }).notNull(),
    lastSeq: integer('last_seq').notNull(),
    startedAt: integer('started_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [
    index('agent_runs_status_idx').on(t.status, t.updatedAt),
    index('agent_runs_conversation_idx').on(t.conversationId, t.updatedAt),
  ],
);
