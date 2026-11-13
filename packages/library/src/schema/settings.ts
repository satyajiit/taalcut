// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Drizzle tables: Setting, the model-profile state (PRD 8.4), Acknowledgement
 * (the warning-card pattern, PRD 10.1) and CloudCall (one row per outbound
 * model request, behind Settings → Usage, PRD G9). No secrets in any of them:
 * tokens live in the keychain (AGENTS.md, "Secrets").
 */
import {
  BILLED_UNITS,
  CLOUD_CALL_OUTCOMES,
  REASONING_LEVELS,
  type CloudCallId,
  type ProjectId,
  type RunId,
} from '@taalcut/core';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { AcknowledgementId } from '../ids';
import { projects } from './chat';

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

/** One row (id 1): the profiles document. Its schema belongs to @taalcut/models. */
export const modelProfileState = sqliteTable('model_profile_state', {
  id: integer('id').primaryKey(),
  state: text('state', { mode: 'json' }).$type<unknown>().notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const acknowledgements = sqliteTable(
  'acknowledgements',
  {
    id: text('id').$type<AcknowledgementId>().primaryKey(),
    /** Which warning card or gated feature, e.g. 'login.claude', 'reference.keepAudio'. */
    featureId: text('feature_id').notNull(),
    /** The card shows again when this changes. */
    termsVersion: text('terms_version').notNull(),
    acknowledgedAt: integer('acknowledged_at').notNull(),
    /** Anything the card wants to remember, e.g. the provider. Never secrets. */
    context: text('context', { mode: 'json' }).$type<unknown>(),
  },
  (t) => [uniqueIndex('acknowledgements_feature_terms_uq').on(t.featureId, t.termsVersion)],
);

/** Core's CloudCallRecord, column for column (cost as integer micro-dollars, latency as whole ms). */
export const cloudCalls = sqliteTable(
  'cloud_calls',
  {
    id: text('id').$type<CloudCallId>().primaryKey(),
    /** Model module (PRD 8.2): 'agent', 'vision', 'embeddings', … */
    module: text('module').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    bytesSent: integer('bytes_sent').notNull().default(0),
    inputTokens: integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    /** Cost in millionths of a US dollar, as an integer so sums don't drift. */
    costMicroUsd: integer('cost_micro_usd').notNull().default(0),
    /** A plan call records no incremental API dollars; its quota consumption is still provider-managed. */
    billing: text('billing', { enum: ['apiKey', 'subscription'] }),
    latencyMs: integer('latency_ms').notNull(),
    outcome: text('outcome', { enum: CLOUD_CALL_OUTCOMES }).notNull(),
    errorCode: text('error_code'),
    runId: text('run_id').$type<RunId>(),
    projectId: text('project_id')
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: 'set null' }),
    startedAt: integer('started_at').notNull(),
    reasoning: text('reasoning', { enum: REASONING_LEVELS }).notNull().default('off'),
    /** The endpoint is on this machine: nothing left the device. */
    local: integer('local', { mode: 'boolean' }).notNull().default(false),
    bytesReceived: integer('bytes_received').notNull().default(0),
    cachedInputTokens: integer('cached_input_tokens').notNull().default(0),
    cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
    httpStatus: integer('http_status'),
    /** 1 for the primary model, 2+ when the fallback chain moved on. */
    attempt: integer('attempt').notNull().default(1),
    spanId: text('span_id'),
    /** Migration 23 (G8): what a non-token API billed (CloudCallRecord.billed); both null for a token call. */
    billedUnit: text('billed_unit', { enum: BILLED_UNITS }),
    billedQuantity: real('billed_quantity'),
  },
  (t) => [
    index('cloud_calls_started_idx').on(t.startedAt),
    index('cloud_calls_module_idx').on(t.module, t.startedAt),
    index('cloud_calls_run_idx').on(t.runId),
    /** A project's spend (migration 15, ProjectBudgetStore). */
    index('cloud_calls_project_idx').on(t.projectId, t.startedAt),
  ],
);
