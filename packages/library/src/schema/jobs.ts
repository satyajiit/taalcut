// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Drizzle table: Job, the durable queue behind the job system (PRD G7, plan P1-E1). */
import { JOB_STATES, RESOURCE_CLASSES, type JobId, type JobPriority, type ProjectId } from '@taalcut/core';
import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { projects } from './chat';

/**
 * Core's priority classes as `jobs.priority` stores them (higher runs first). Every writer uses this
 * one scale: @taalcut/jobs' `PRIORITY_VALUES` (a kind's own priority), the jobs process's queue glue,
 * `indexing.prioritise` and the core JobStore port. Any other positive or negative number reads as
 * high or low.
 */
export const JOB_PRIORITY_VALUES = { low: -10, normal: 0, high: 10 } as const satisfies Readonly<
  Record<JobPriority, number>
>;

/** Jobs in these states own their idempotency key; a failed or cancelled job doesn't block a new one. */
export const LIVE_JOB_STATES = ['queued', 'running', 'paused', 'succeeded'] as const;

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').$type<JobId>().primaryKey(),
    /** Handler name, e.g. 'media.probe'. */
    kind: text('kind').notNull(),
    state: text('state', { enum: JOB_STATES }).notNull(),
    /** Higher runs first. Core's priorities map to 10 (high), 0 (normal), −10 (low): JOB_PRIORITY_VALUES. */
    priority: integer('priority').notNull().default(0),
    resourceClass: text('resource_class', { enum: RESOURCE_CLASSES }).notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    /** Not started before this time (ms); null means now. Backoff sets it after a retryable failure. */
    nextRunAt: integer('next_run_at'),
    idempotencyKey: text('idempotency_key'),
    /** 0..1, null when unknown. */
    progress: real('progress'),
    /** Extra progress for the card, e.g. { completed: 3, total: 10 }. */
    progressDetail: text('progress_detail', { mode: 'json' }).$type<unknown>(),
    payload: text('payload', { mode: 'json' }).$type<unknown>().notNull(),
    result: text('result', { mode: 'json' }).$type<unknown>(),
    error: text('error', { mode: 'json' }).$type<unknown>(),
    /** Worker holding the job while running; the lease lets a restarted process reclaim it. */
    leaseOwner: text('lease_owner'),
    leaseExpiresAt: integer('lease_expires_at'),
    projectId: text('project_id')
      .$type<ProjectId>()
      .references(() => projects.id, { onDelete: 'set null' }),
    parentId: text('parent_id').$type<JobId>(),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull(),
    startedAt: integer('started_at'),
    finishedAt: integer('finished_at'),
    /** Attempts a restart of the jobs process cut short (migration 10); the engine's free restarts read it. */
    interruptions: integer('interruptions').notNull().default(0),
    /**
     * Claim order within a priority, lower first, null last (core's jobOrderKeySchema; migration 25): the
     * indexing pipeline's asset import order, so indexing goes depth-first by asset.
     */
    orderKey: integer('order_key'),
  },
  (t) => [
    // The claim order (repositories/jobs.ts `claimOrder`), so a claim walks the index without sorting.
    index('jobs_claim_order_idx').on(
      t.state,
      t.resourceClass,
      sql`${t.priority} DESC`,
      sql`(${t.orderKey} IS NULL)`,
      t.orderKey,
      sql`coalesce(${t.nextRunAt}, ${t.createdAt})`,
      t.id,
    ),
    index('jobs_lease_idx').on(t.state, t.leaseExpiresAt),
    uniqueIndex('jobs_idempotency_live_uq')
      .on(t.idempotencyKey)
      .where(
        sql`${t.idempotencyKey} IS NOT NULL AND ${t.state} IN ('queued', 'running', 'paused', 'succeeded')`,
      ),
    index('jobs_project_idx').on(t.projectId, t.createdAt),
    index('jobs_parent_idx').on(t.parentId),
  ],
);
