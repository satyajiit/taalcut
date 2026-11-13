// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Saved timeline versions (P2-X3): snapshots of a timeline's document,
 * numbered 1, 2, 3… per timeline. Kinds: `auto` (taken by the store when a
 * timeline is created, i.e. after an agent assembly, and on a put once 10
 * minutes have passed since the last auto), `named` (project.saveVersion),
 * `before-restore` (project.restoreVersion) and `export` (the render lane,
 * for the revision it exported). An `auto` identical to the newest version is
 * skipped; only the newest 50 autos per timeline are kept. Synchronous: the
 * store and the project commands call it inside their transactions.
 */
import {
  ConflictError,
  err,
  newId,
  NotFoundError,
  ok,
  ValidationError,
  type CommandId,
  type Result,
  type TimelineId,
  type TimelineVersionId,
  type TimelineVersionSummary,
  type TIMELINE_VERSION_KINDS,
} from '@taalcut/core';
import { and, desc, eq, lt, max, notInArray } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import { attemptWrite, inTransaction } from '../repositories/shared';
import { timelines, timelineVersions } from '../schema/projects';
import { cleanText, decodeCursor, encodeCursor } from './canonical';
import { documentHash } from './timeline-rows';

export type TimelineVersionKind = (typeof TIMELINE_VERSION_KINDS)[number];
type VersionRow = typeof timelineVersions.$inferSelect;

export const AUTO_VERSION_INTERVAL_MS = 10 * 60 * 1000;
export const AUTO_VERSIONS_KEPT = 50;

export interface SnapshotInput {
  readonly timelineId: TimelineId;
  readonly kind: TimelineVersionKind;
  readonly label?: string | null;
  /** Default: a new id. Commands pass one derived from their id, so redo recreates the same version. */
  readonly id?: TimelineVersionId;
  readonly commandId?: CommandId | null;
  /** The revision to keep (an export's); default the working copy's. An older one is copied from a version. */
  readonly revision?: number;
}

export interface TimelineVersionRecord {
  readonly summary: TimelineVersionSummary;
  readonly schemaVersion: number;
  /** As stored; @taalcut/timeline migrates and validates it. */
  readonly json: unknown;
  readonly documentHash: string;
}

export interface TimelineVersions {
  /** The new version, or null when an `auto` equal to the newest version was skipped. */
  snapshot(input: SnapshotInput): Result<TimelineVersionSummary | null>;
  get(id: TimelineVersionId): Result<TimelineVersionRecord>;
  /** Newest first. */
  list(
    timelineId: TimelineId,
    page?: { readonly limit?: number; readonly cursor?: string },
  ): Result<{ items: TimelineVersionSummary[]; nextCursor?: string }>;
  /** The newest version holding this document (documentHash), if any. */
  findByHash(timelineId: TimelineId, hash: string): TimelineVersionSummary | undefined;
  rename(id: TimelineVersionId, label: string | null): Result<TimelineVersionSummary>;
  remove(id: TimelineVersionId): Result<void>;
  /** An `auto` of the working copy if 10 minutes passed since the newest auto (the store calls it on put). */
  autosave(timelineId: TimelineId): Result<TimelineVersionSummary | null>;
  /** Autos past the newest 50 of each timeline (or of one). `library.collect` calls it daily. */
  pruneAutos(timelineId?: TimelineId): Result<number>;
}

export function toVersionSummary(row: VersionRow): TimelineVersionSummary {
  return {
    id: row.id,
    timelineId: row.timelineId,
    number: row.number,
    kind: row.kind,
    label: row.label,
    revision: row.revision,
    createdAt: row.createdAt,
  };
}

const missing = (id: TimelineVersionId) => err(NotFoundError({ entity: 'timeline_version', id }));

function cleanLabel(label: string | null | undefined): Result<string | null> {
  if (label === null || label === undefined) return ok(null);
  const clean = cleanText(label);
  return clean && clean.length <= 100 ? ok(clean) : err(ValidationError({ field: 'label' }));
}

export function createTimelineVersions(db: LibraryDatabase): TimelineVersions {
  const { orm } = db;
  const byId = (id: TimelineVersionId) =>
    orm.select().from(timelineVersions).where(eq(timelineVersions.id, id)).get();
  const newest = (timelineId: TimelineId, kind?: TimelineVersionKind) =>
    orm
      .select()
      .from(timelineVersions)
      .where(
        and(eq(timelineVersions.timelineId, timelineId), kind ? eq(timelineVersions.kind, kind) : undefined),
      )
      .orderBy(desc(timelineVersions.number))
      .get();

  /** The document to keep: the working copy at `revision`, or a version that already holds that revision. */
  function source(timelineId: TimelineId, revision?: number) {
    const working = orm.select().from(timelines).where(eq(timelines.id, timelineId)).get();
    if (!working) return err(NotFoundError({ entity: 'timeline', id: timelineId }));
    if (revision === undefined || revision === working.revision)
      return ok({
        document: working.document,
        schemaVersion: working.schemaVersion,
        revision: working.revision,
      });
    const held = orm
      .select()
      .from(timelineVersions)
      .where(and(eq(timelineVersions.timelineId, timelineId), eq(timelineVersions.revision, revision)))
      .orderBy(desc(timelineVersions.number))
      .get();
    return held
      ? ok({ document: held.document, schemaVersion: held.schemaVersion, revision })
      : err(NotFoundError({ entity: 'timeline_revision', id: `${timelineId}@${revision}` }));
  }

  function pruneAutos(timelineId?: TimelineId): Result<number> {
    return inTransaction(db, 'timeline_version', () => {
      const ids = timelineId
        ? [timelineId]
        : orm
            .selectDistinct({ id: timelineVersions.timelineId })
            .from(timelineVersions)
            .where(eq(timelineVersions.kind, 'auto'))
            .all()
            .map((r) => r.id);
      let removed = 0;
      for (const id of ids) {
        const keep = orm
          .select({ id: timelineVersions.id })
          .from(timelineVersions)
          .where(and(eq(timelineVersions.timelineId, id), eq(timelineVersions.kind, 'auto')))
          .orderBy(desc(timelineVersions.number))
          .limit(AUTO_VERSIONS_KEPT)
          .all()
          .map((r) => r.id);
        removed += orm
          .delete(timelineVersions)
          .where(
            and(
              eq(timelineVersions.timelineId, id),
              eq(timelineVersions.kind, 'auto'),
              keep.length ? notInArray(timelineVersions.id, keep) : undefined,
            ),
          )
          .run().changes;
      }
      return ok(removed);
    });
  }

  function snapshot(input: SnapshotInput): Result<TimelineVersionSummary | null> {
    const label = cleanLabel(input.label);
    if (!label.ok) return label;
    return inTransaction(db, 'timeline_version', () => {
      const from = source(input.timelineId, input.revision);
      if (!from.ok) return from;
      const hash = documentHash(from.value.document);
      if (input.kind === 'auto' && newest(input.timelineId)?.documentHash === hash) return ok(null);
      if (input.id && byId(input.id)) return err(ConflictError({ entity: 'timeline_version', id: input.id }));
      const top = orm
        .select({ number: max(timelineVersions.number) })
        .from(timelineVersions)
        .where(eq(timelineVersions.timelineId, input.timelineId))
        .get();
      const row: VersionRow = {
        id: input.id ?? newId<'TimelineVersion'>(),
        timelineId: input.timelineId,
        number: (top?.number ?? 0) + 1,
        kind: input.kind,
        label: label.value,
        schemaVersion: from.value.schemaVersion,
        document: from.value.document,
        revision: from.value.revision,
        documentHash: hash,
        commandId: input.commandId ?? null,
        createdAt: db.clock(),
      };
      orm.insert(timelineVersions).values(row).run();
      if (input.kind === 'auto') {
        const pruned = pruneAutos(input.timelineId);
        if (!pruned.ok) return pruned;
      }
      return ok(toVersionSummary(row));
    });
  }

  return {
    snapshot,
    get(id) {
      const row = byId(id);
      if (!row) return missing(id);
      return ok({
        summary: toVersionSummary(row),
        schemaVersion: row.schemaVersion,
        json: row.document,
        documentHash: row.documentHash,
      });
    },
    list(timelineId, page = {}) {
      const limit = Math.max(1, Math.min(200, Math.floor(page.limit ?? 50)));
      const after = page.cursor === undefined ? undefined : decodeCursor(page.cursor);
      if (page.cursor !== undefined && !after) return err(ValidationError({ field: 'cursor' }));
      const rows = orm
        .select()
        .from(timelineVersions)
        .where(
          and(
            eq(timelineVersions.timelineId, timelineId),
            after ? lt(timelineVersions.number, after.at) : undefined,
          ),
        )
        .orderBy(desc(timelineVersions.number))
        .limit(limit + 1)
        .all();
      const items = rows.slice(0, limit).map(toVersionSummary);
      const last = items.at(-1);
      return ok({
        items,
        ...(rows.length > limit && last ? { nextCursor: encodeCursor(last.number, last.id) } : {}),
      });
    },
    findByHash(timelineId, hash) {
      const row = orm
        .select()
        .from(timelineVersions)
        .where(and(eq(timelineVersions.timelineId, timelineId), eq(timelineVersions.documentHash, hash)))
        .orderBy(desc(timelineVersions.number))
        .get();
      return row ? toVersionSummary(row) : undefined;
    },
    rename(id, label) {
      const clean = cleanLabel(label);
      if (!clean.ok) return clean;
      const updated = attemptWrite(db, 'timeline_version', () =>
        orm
          .update(timelineVersions)
          .set({ label: clean.value })
          .where(eq(timelineVersions.id, id))
          .returning()
          .get(),
      );
      if (!updated.ok) return updated;
      return updated.value ? ok(toVersionSummary(updated.value)) : missing(id);
    },
    remove(id) {
      const removed = attemptWrite(
        db,
        'timeline_version',
        () => orm.delete(timelineVersions).where(eq(timelineVersions.id, id)).run().changes,
      );
      if (!removed.ok) return removed;
      return removed.value > 0 ? ok(undefined) : missing(id);
    },
    autosave(timelineId) {
      const last = newest(timelineId, 'auto');
      if (last && db.clock() - last.createdAt < AUTO_VERSION_INTERVAL_MS) return ok(null);
      return snapshot({ timelineId, kind: 'auto' });
    },
    pruneAutos,
  };
}
