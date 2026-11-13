// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Drizzle tables: persisted agent traces (P1-G5) for the developer trace viewer. */
import { RUN_STATUSES, type ConversationId, type RunId } from '@taalcut/core';
import { index, integer, primaryKey, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { SPAN_KINDS, SPAN_STATUSES } from '../traces/types';
import { conversations } from './chat';

export const traceRuns = sqliteTable(
  'trace_runs',
  {
    runId: text('run_id').$type<RunId>().primaryKey(),
    conversationId: text('conversation_id')
      .$type<ConversationId>()
      .references(() => conversations.id, { onDelete: 'set null' }),
    status: text('status', { enum: RUN_STATUSES }).notNull(),
    /** The user's request, redacted. */
    message: text('message').notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    gaps: text('gaps', { mode: 'json' }).$type<unknown>().notNull().default([]),
  },
  (t) => [index('trace_runs_started_idx').on(t.startedAt)],
);

export const traceSpans = sqliteTable(
  'trace_spans',
  {
    runId: text('run_id')
      .$type<RunId>()
      .notNull()
      .references(() => traceRuns.runId, { onDelete: 'cascade' }),
    spanId: text('span_id').notNull(),
    parentSpanId: text('parent_span_id'),
    kind: text('kind', { enum: SPAN_KINDS }).notNull(),
    name: text('name').notNull(),
    status: text('status', { enum: SPAN_STATUSES }).notNull(),
    startedAt: integer('started_at').notNull(),
    endedAt: integer('ended_at'),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),
    cachedInputTokens: integer('cached_input_tokens'),
    costUsd: real('cost_usd'),
    cacheHit: integer('cache_hit', { mode: 'boolean' }),
    /** Everything else in the span (provider, model, tool, events, …), redacted. */
    attributes: text('attributes', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  },
  (t) => [primaryKey({ columns: [t.runId, t.spanId] })],
);
