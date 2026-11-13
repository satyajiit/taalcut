// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's RenderStore (P2-M11) over migration 16: one row per RenderRecord.
 * Records are checked against core's schemas on create and after every
 * patch. `requestKey` de-duplicates `render.export`: `list({ requestKey })`
 * finds a render with the same key that isn't failed, cancelled or deleted.
 * `progress` is the jobs process's (job.progress events), never stored: a
 * record reads with `progress: null`. The file path stays in the record for
 * the main and render processes; nothing here builds a window's snapshot.
 * P3: `batch_id` is stored beside the request: the record's batch, else the
 * request's (migration 19 backfilled older rows), so a batch lists through its
 * index. `credentials` is the Content Credentials
 * object; a null column reads as `{ added: false, state: null }`.
 */
import {
  all,
  ConflictError,
  err,
  exportRequestSchema,
  NotFoundError,
  ok,
  parseId,
  qaReportSchema,
  renderCredentialsSchema,
  renderSnapshotSchema,
  ValidationError,
  type RenderBatchId,
  type RenderId,
  type RenderPatch,
  type RenderRecord,
  type RenderStore,
  type Result,
} from '@taalcut/core';
import { and, desc, eq, isNull, notInArray } from 'drizzle-orm';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { attemptWrite, pageSize } from '../repositories/shared';
import { renders } from '../schema/projects';

type RenderRow = typeof renders.$inferSelect;

const recordSchema = renderSnapshotSchema.omit({ progress: true }).extend({
  request: exportRequestSchema,
  filePath: z.string().min(1).max(4096).nullable(),
  compositionHash: z.string().min(1).max(128).nullable(),
  qaReport: qaReportSchema.nullable(),
});
const requestKeySchema = z.string().min(1).max(256);

/** Statuses a de-duplicating request no longer matches. */
const ENDED = ['failed', 'cancelled'] as const;

const NO_CREDENTIALS = { added: false, state: null } as const;

/** The column is drizzle's JSON mode, so it arrives parsed; null (every row before migration 19) reads as not added. */
function credentialsOf(value: unknown): RenderRecord['credentials'] {
  const parsed = renderCredentialsSchema.safeParse(value);
  return parsed.success ? parsed.data : NO_CREDENTIALS;
}

function batchOf(stored: string | null, fromRequest: RenderBatchId | null | undefined): RenderBatchId | null {
  if (stored) {
    const parsed = parseId<'RenderBatch'>(stored);
    if (parsed.ok) return parsed.value;
  }
  return fromRequest ?? null;
}

/**
 * The stored request is parsed, so a Phase 2 row reads with the defaults the type
 * promises (`includeBumpers: true`, `contentCredentials: { add: false }`). Every
 * row passed this schema when it was written; one that no longer parses is
 * corrupt and is an error, not a cast.
 */
function toRecord(row: RenderRow): Result<RenderRecord> {
  const parsedRequest = exportRequestSchema.safeParse(row.request);
  if (!parsedRequest.success) {
    return err(
      ValidationError(
        { field: 'render.request' },
        { detail: `render ${row.id}: ${parsedRequest.error.message.slice(0, 1000)}` },
      ),
    );
  }
  const request = parsedRequest.data;
  return ok({
    id: row.id,
    projectId: row.projectId,
    timelineId: row.timelineId,
    timelineRevision: row.timelineRevision,
    presetId: row.presetId,
    status: row.status,
    jobId: row.jobId,
    progress: null,
    name: row.name,
    width: row.width,
    height: row.height,
    rate: { num: row.rateNum, den: row.rateDen },
    durationFrames: row.durationFrames,
    bytes: row.bytes,
    music: row.music,
    captions: row.captions as RenderRecord['captions'],
    qa: row.qa as RenderRecord['qa'],
    supersedes: row.supersedes,
    notify: row.notify,
    error: row.error as RenderRecord['error'],
    credentials: credentialsOf(row.credentials),
    batchId: batchOf(row.batchId, request.batchId),
    createdAt: row.createdAt,
    finishedAt: row.finishedAt,
    deletedAt: row.deletedAt,
    request,
    filePath: row.filePath,
    compositionHash: row.compositionHash,
    qaReport: row.qaReport as RenderRecord['qaReport'],
  });
}

function toColumns(record: Omit<RenderRecord, 'progress'>) {
  return {
    projectId: record.projectId,
    timelineId: record.timelineId,
    timelineRevision: record.timelineRevision,
    presetId: record.presetId,
    status: record.status,
    jobId: record.jobId,
    name: record.name.normalize('NFC'),
    width: record.width,
    height: record.height,
    rateNum: record.rate.num,
    rateDen: record.rate.den,
    durationFrames: record.durationFrames,
    bytes: record.bytes,
    music: record.music,
    captions: record.captions,
    qa: record.qa,
    qaReport: record.qaReport,
    supersedes: record.supersedes,
    notify: record.notify,
    error: record.error,
    request: record.request,
    filePath: record.filePath,
    compositionHash: record.compositionHash,
    credentials: record.credentials,
    batchId: record.batchId ?? record.request.batchId ?? null,
    createdAt: record.createdAt,
    finishedAt: record.finishedAt,
    deletedAt: record.deletedAt,
  };
}

/** The record as the schema reads it: what is written is the parsed value, defaults included. */
function check(record: Omit<RenderRecord, 'progress'>): Result<Omit<RenderRecord, 'progress'>> {
  const parsed = recordSchema.safeParse(record);
  return parsed.success
    ? ok(parsed.data)
    : err(ValidationError({ field: 'render' }, { detail: parsed.error.message.slice(0, 2000) }));
}

/** The stored record with `patch` applied, checked as a whole. */
function patched(stored: RenderRow, patch: RenderPatch): Result<Omit<RenderRecord, 'progress'>> {
  const read = toRecord(stored);
  if (!read.ok) return read;
  const { progress: _progress, ...current } = read.value;
  return check({ ...current, ...patch });
}

export function createRenderStore(db: LibraryDatabase): RenderStore {
  const { orm } = db;
  const row = (id: RenderId) => orm.select().from(renders).where(eq(renders.id, id)).get();
  const missing = (id: RenderId) => err(NotFoundError({ entity: 'render', id }));

  return {
    async create(input) {
      const { requestKey, ...rest } = input;
      const record = { ...rest } as Omit<RenderRecord, 'progress'> & { progress?: unknown };
      delete record.progress;
      const valid = check(record);
      if (!valid.ok) return valid;
      if (!requestKeySchema.safeParse(requestKey).success)
        return err(ValidationError({ field: 'requestKey' }));
      if (row(record.id)) return err(ConflictError({ entity: 'render', id: record.id }));
      const saved = attemptWrite(db, 'render', () =>
        orm
          .insert(renders)
          .values({ id: valid.value.id, requestKey, ...toColumns(valid.value) })
          .returning()
          .get(),
      );
      return saved.ok ? toRecord(saved.value) : saved;
    },

    async get(id) {
      const stored = row(id);
      return stored ? toRecord(stored) : missing(id);
    },

    async list(filter = {}) {
      const rows = orm
        .select()
        .from(renders)
        .where(
          and(
            filter.projectId ? eq(renders.projectId, filter.projectId) : undefined,
            filter.includeDeleted && !filter.requestKey ? undefined : isNull(renders.deletedAt),
            filter.requestKey ? eq(renders.requestKey, filter.requestKey) : undefined,
            filter.requestKey ? notInArray(renders.status, [...ENDED]) : undefined,
            filter.batchId ? eq(renders.batchId, filter.batchId) : undefined,
          ),
        )
        .orderBy(desc(renders.createdAt), desc(renders.id))
        .limit(pageSize(filter.limit, 100, 500))
        .all();
      return all(rows.map(toRecord));
    },

    async update(id, patch: RenderPatch) {
      const stored = row(id);
      if (!stored) return missing(id);
      const valid = patched(stored, patch);
      if (!valid.ok) return valid;
      const saved = attemptWrite(db, 'render', () =>
        orm.update(renders).set(toColumns(valid.value)).where(eq(renders.id, id)).returning().get(),
      );
      if (!saved.ok) return saved;
      return saved.value ? toRecord(saved.value) : missing(id);
    },
  };
}
