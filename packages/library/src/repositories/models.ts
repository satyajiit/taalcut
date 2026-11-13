// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The cloud-call log (PRD G9, P1-F5: one row per outbound model request,
 * shown in Settings → Usage) in core's CloudCallRecord shape, and the
 * model-profile state, an opaque JSON document owned by @taalcut/models.
 */
import {
  cloudCallRecordSchema,
  err,
  ok,
  ValidationError,
  type CloudCallRecord,
  type ModelModuleId,
  type ProjectId,
  type Result,
  type RunId,
} from '@taalcut/core';
import { and, asc, desc, eq, gte, lt, sql } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { cloudCalls, modelProfileState } from '../schema/settings';
import { containsSecret, redactText } from '../secrets/redact';
import { attemptWrite, pageSize } from './shared';

export type CloudCallRow = typeof cloudCalls.$inferSelect;

export interface CloudCallTotals {
  readonly module: string;
  readonly provider: string;
  readonly calls: number;
  readonly bytesSent: number;
  readonly bytesReceived: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly costMicroUsd: number;
}

export interface CloudCallQuery {
  /** Inclusive, on startedAt. */
  readonly since?: number;
  /** Exclusive. */
  readonly until?: number;
  readonly module?: string;
  readonly runId?: string;
  readonly limit?: number;
}

export interface CloudCallRepository {
  /**
   * Stores one row per call. Recording the same id again changes nothing
   * (created: false), so a retried write can't count a call twice.
   */
  record(call: CloudCallRecord): Result<{ readonly created: boolean }>;
  /** Newest first. */
  list(query?: CloudCallQuery): CloudCallRecord[];
  /** Totals per module and provider for Settings → Usage. */
  totals(query?: Omit<CloudCallQuery, 'limit'>): CloudCallTotals[];
}

export interface ModelProfileStateRepository {
  /** The saved document, or undefined before the first save. */
  load(): unknown;
  /** Replaces the document. ValidationError unless it is plain JSON without secrets (max 1 MB). */
  save(state: unknown): Result<void>;
  /** What `save` would refuse, without writing. */
  check(state: unknown): Result<void>;
}

const MAX_STATE_BYTES = 1_000_000;

/** A stored row as core's CloudCallRecord (cost back in dollars). */
export function toCloudCallRecord(row: CloudCallRow): CloudCallRecord {
  return {
    id: row.id,
    module: row.module as ModelModuleId,
    provider: row.provider,
    model: row.model,
    reasoning: row.reasoning,
    local: row.local,
    startedAt: row.startedAt,
    latencyMs: row.latencyMs,
    bytesSent: row.bytesSent,
    bytesReceived: row.bytesReceived,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    cachedInputTokens: row.cachedInputTokens,
    cacheWriteTokens: row.cacheWriteTokens,
    costUsd: row.costMicroUsd / 1_000_000,
    ...(row.billing == null ? {} : { billing: row.billing }),
    outcome: row.outcome,
    ...(row.errorCode === null ? {} : { errorCode: row.errorCode }),
    ...(row.httpStatus === null ? {} : { httpStatus: row.httpStatus }),
    attempt: row.attempt,
    ...(row.runId === null ? {} : { runId: row.runId }),
    ...(row.spanId === null ? {} : { spanId: row.spanId }),
    ...(row.projectId === null ? {} : { projectId: row.projectId }),
    ...(row.billedUnit === null || row.billedQuantity === null
      ? {}
      : { billed: { unit: row.billedUnit, quantity: row.billedQuantity } }),
  };
}

function range(query: CloudCallQuery) {
  return and(
    query.since !== undefined ? gte(cloudCalls.startedAt, query.since) : undefined,
    query.until !== undefined ? lt(cloudCalls.startedAt, query.until) : undefined,
    query.module ? eq(cloudCalls.module, query.module) : undefined,
    query.runId ? eq(cloudCalls.runId, query.runId as RunId) : undefined,
  );
}

export function createCloudCallRepository(db: LibraryDatabase): CloudCallRepository {
  const { orm } = db;
  // A call for a project deleted since (or never stored) keeps its row without the project.
  const project = db.driver.prepare('SELECT id FROM projects WHERE id = ?');
  const knownProject = (id: ProjectId | undefined) => (id !== undefined && project.get(id) ? id : null);
  return {
    record(call) {
      const parsed = cloudCallRecordSchema.safeParse(call);
      if (!parsed.success) {
        const field = parsed.error.issues[0]?.path.map(String).join('.') || undefined;
        return err(ValidationError(field ? { field } : undefined, { detail: parsed.error.message }));
      }
      const c = parsed.data;
      // The record holds sizes and counts only; its few strings are redacted in case an error code echoes a token.
      const text = (value: string | undefined) => (value === undefined ? null : redactText(value));
      const row: CloudCallRow = {
        id: c.id,
        module: c.module,
        provider: redactText(c.provider),
        model: redactText(c.model),
        reasoning: c.reasoning,
        local: c.local,
        startedAt: c.startedAt,
        latencyMs: Math.round(c.latencyMs),
        bytesSent: c.bytesSent,
        bytesReceived: c.bytesReceived,
        inputTokens: c.inputTokens,
        outputTokens: c.outputTokens,
        cachedInputTokens: c.cachedInputTokens,
        cacheWriteTokens: c.cacheWriteTokens,
        costMicroUsd: Math.round(c.costUsd * 1_000_000),
        billing: c.billing ?? null,
        outcome: c.outcome,
        errorCode: text(c.errorCode),
        httpStatus: c.httpStatus ?? null,
        attempt: c.attempt,
        runId: text(c.runId) as RunId | null,
        spanId: text(c.spanId),
        projectId: knownProject(c.projectId),
        billedUnit: c.billed?.unit ?? null,
        billedQuantity: c.billed?.quantity ?? null,
      };
      return attemptWrite(db, 'cloud_call', () => ({
        created:
          orm.insert(cloudCalls).values(row).onConflictDoNothing({ target: cloudCalls.id }).run().changes > 0,
      }));
    },
    list(query = {}) {
      return orm
        .select()
        .from(cloudCalls)
        .where(range(query))
        .orderBy(desc(cloudCalls.startedAt), desc(cloudCalls.id))
        .limit(pageSize(query.limit, 500, 10_000))
        .all()
        .map(toCloudCallRecord);
    },
    totals(query = {}) {
      return orm
        .select({
          module: cloudCalls.module,
          provider: cloudCalls.provider,
          calls: sql<number>`count(*)`,
          bytesSent: sql<number>`sum(${cloudCalls.bytesSent})`,
          bytesReceived: sql<number>`sum(${cloudCalls.bytesReceived})`,
          inputTokens: sql<number>`sum(${cloudCalls.inputTokens})`,
          outputTokens: sql<number>`sum(${cloudCalls.outputTokens})`,
          costMicroUsd: sql<number>`sum(${cloudCalls.costMicroUsd})`,
        })
        .from(cloudCalls)
        .where(range(query))
        .groupBy(cloudCalls.module, cloudCalls.provider)
        .orderBy(asc(cloudCalls.module), asc(cloudCalls.provider))
        .all();
    },
  };
}

/** Plain JSON: null, booleans, finite numbers, strings, arrays and plain objects, without cycles. */
export function isPlainJson(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  const proto = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && proto !== Object.prototype && proto !== null) return false;
  seen.add(value);
  const valid = Object.values(value).every((item) => isPlainJson(item, seen));
  seen.delete(value);
  return valid;
}

/** ok(value) if it is plain JSON without secrets and at most `maxBytes` as text. */
export function checkStorableJson(field: string, value: unknown, maxBytes: number): Result<string> {
  if (!isPlainJson(value)) return err(ValidationError({ field }, { detail: 'not plain JSON' }));
  if (containsSecret(value))
    return err(ValidationError({ field }, { detail: 'looks like it holds a secret' }));
  const text = JSON.stringify(value);
  if (Buffer.byteLength(text) > maxBytes) return err(ValidationError({ field }, { detail: 'too large' }));
  return ok(text);
}

export function createModelProfileStateRepository(db: LibraryDatabase): ModelProfileStateRepository {
  const { orm } = db;
  return {
    load: () => orm.select().from(modelProfileState).where(eq(modelProfileState.id, 1)).get()?.state,
    check(state) {
      const checked = checkStorableJson('state', state, MAX_STATE_BYTES);
      return checked.ok ? ok(undefined) : checked;
    },
    save(state) {
      const checked = checkStorableJson('state', state, MAX_STATE_BYTES);
      if (!checked.ok) return checked;
      // JSON null must be the text 'null': SQL NULL would break the NOT NULL column.
      const row = { id: 1, state: state === null ? sql`'null'` : state, updatedAt: db.clock() };
      return attemptWrite(db, 'model_profile_state', () => {
        orm
          .insert(modelProfileState)
          .values(row)
          .onConflictDoUpdate({
            target: modelProfileState.id,
            set: { state: row.state, updatedAt: row.updatedAt },
          })
          .run();
      });
    },
  };
}
