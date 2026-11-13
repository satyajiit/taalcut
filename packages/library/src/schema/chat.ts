// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle tables: Project, Conversation, Message, ToolRun (PRD 6.3).
 * The SQL that creates them is in migrations/0001-phase1-core.ts; a test
 * checks the two agree. Times are integer milliseconds since the epoch.
 */
import {
  SIDE_EFFECTS,
  type CommandId,
  type ConversationId,
  type MessageId,
  type ProjectId,
  type RunId,
  type ToolRunId,
} from '@taalcut/core';
import { index, integer, primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').$type<ProjectId>().primaryKey(),
    name: text('name').notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    // Migration 15 (P2-X3, P2-X1).
    /** Deleting a project in the UI archives it (undoable); a purge is Phase 3. */
    archivedAt: integer('archived_at'),
    lastOpenedAt: integer('last_opened_at'),
    /** The spending cap in micro-units of `budgetCapCurrency`; both null: no cap. */
    budgetCapMicros: integer('budget_cap_micros'),
    budgetCapCurrency: text('budget_cap_currency'),
  },
  (t) => [index('projects_archived_idx').on(t.archivedAt, t.updatedAt)],
);

export const conversations = sqliteTable(
  'conversations',
  {
    id: text('id').$type<ConversationId>().primaryKey(),
    /** Null for chats outside a project (e.g. library questions). */
    projectId: text('project_id')
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: 'cascade' }),
    title: text('title'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    /** Archived conversations leave the main list; unarchiving brings them back. */
    archivedAt: integer('archived_at'),
    /** Soft delete: hidden everywhere until restored (undo) or purged. */
    deletedAt: integer('deleted_at'),
  },
  (t) => [
    index('conversations_project_idx').on(t.projectId, t.updatedAt),
    index('conversations_recent_idx').on(t.updatedAt),
  ],
);

export const MESSAGE_ROLES = ['user', 'assistant', 'system', 'tool'] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').$type<MessageId>().primaryKey(),
    conversationId: text('conversation_id')
      .$type<ConversationId>()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    role: text('role', { enum: MESSAGE_ROLES }).notNull(),
    /** Message parts (text, card payloads, artifact references) as JSON. */
    content: text('content', { mode: 'json' }).$type<unknown>().notNull(),
    /** The agent run that produced it, if any. */
    runId: text('run_id').$type<RunId>(),
    createdAt: integer('created_at').notNull(),
  },
  (t) => [index('messages_conversation_idx').on(t.conversationId, t.id)],
);

export const TOOL_RUN_STATUSES = ['running', 'succeeded', 'failed', 'cancelled'] as const;
export type ToolRunStatus = (typeof TOOL_RUN_STATUSES)[number];

export const toolRuns = sqliteTable(
  'tool_runs',
  {
    id: text('id').$type<ToolRunId>().primaryKey(),
    runId: text('run_id').$type<RunId>(),
    conversationId: text('conversation_id')
      .$type<ConversationId>()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    messageId: text('message_id')
      .$type<MessageId>()
      .references(() => messages.id, { onDelete: 'set null' }),
    toolName: text('tool_name').notNull(),
    toolVersion: text('tool_version').notNull(),
    status: text('status', { enum: TOOL_RUN_STATUSES }).notNull(),
    input: text('input', { mode: 'json' }).$type<unknown>().notNull(),
    output: text('output', { mode: 'json' }).$type<unknown>(),
    error: text('error', { mode: 'json' }).$type<unknown>(),
    /** Set when the tool dispatched a command on the command bus. No foreign key: the audit log outlives runs. */
    commandId: text('command_id').$type<CommandId>(),
    startedAt: integer('started_at').notNull(),
    finishedAt: integer('finished_at'),
    sideEffect: text('side_effect', { enum: SIDE_EFFECTS }),
  },
  (t) => [
    index('tool_runs_run_idx').on(t.runId, t.startedAt),
    index('tool_runs_conversation_idx').on(t.conversationId, t.startedAt),
  ],
);

/** The latest payload of each card a conversation shows (core's card protocol); messages refer to them by id. */
export const chatCards = sqliteTable(
  'chat_cards',
  {
    conversationId: text('conversation_id')
      .$type<ConversationId>()
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    cardId: text('card_id').notNull(),
    runId: text('run_id').$type<RunId>(),
    card: text('card', { mode: 'json' }).$type<unknown>().notNull(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.conversationId, t.cardId] })],
);
