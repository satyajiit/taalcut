// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's TimelineStore (P2-X3, for the timeline lane) over migration 15.
 * The working copy is one row; every put needs the stored revision
 * (`core.conflict` otherwise), stores revision + 1 (also in the document),
 * rewrites `timeline_asset_refs` from the clips' media and may take the
 * 10-minute `auto` version. `create` takes the first `auto` (the assembly).
 *
 * Writes given a CommandContext are staged on the command's unit of work:
 * an acknowledged edit is already saved with its audit row (no loss on crash).
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  upgradeTimeline,
  ValidationError,
  type AssetId,
  type CommandContext,
  type Result,
  type Timeline,
  type TimelineId,
  type TimelineStore,
} from '@taalcut/core';
import { desc, eq } from 'drizzle-orm';
import { followCommentsOnWrite } from '../comments/follow-on-write';
import type { LibraryDatabase } from '../db/database';
import { writeWith, type CommandStager } from '../ports/staging';
import { inTransaction } from '../repositories/shared';
import { projects } from '../schema/chat';
import { timelineAssetRefs, timelines } from '../schema/projects';
import {
  documentColumns,
  mediaAssets,
  toTimelineSummary,
  validTimeline,
  type TimelineRow,
} from './timeline-rows';
import { createTimelineVersions, type TimelineVersions } from './timeline-versions';

export interface TimelineStoreOptions {
  /** createLibraryPorts(db).commands: writes with a context commit with the command's audit row. */
  readonly commands?: CommandStager;
}

export interface LibraryTimelineStore extends TimelineStore {
  /** Saved versions of these timelines (project commands, the render lane's export snapshots, collect). */
  readonly versions: TimelineVersions;
}

export function createTimelineStore(
  db: LibraryDatabase,
  options: TimelineStoreOptions = {},
): LibraryTimelineStore {
  const { orm } = db;
  const versions = createTimelineVersions(db);
  const row = (id: TimelineId) => orm.select().from(timelines).where(eq(timelines.id, id)).get();
  const missing = (id: TimelineId) => err(NotFoundError({ entity: 'timeline', id }));

  function setRefs(id: TimelineId, document: unknown): void {
    orm.delete(timelineAssetRefs).where(eq(timelineAssetRefs.timelineId, id)).run();
    const assetIds: AssetId[] = mediaAssets(document);
    if (assetIds.length === 0) return;
    orm
      .insert(timelineAssetRefs)
      .values(assetIds.map((assetId) => ({ timelineId: id, assetId })))
      .onConflictDoNothing()
      .run();
  }

  function write(
    context: CommandContext | undefined,
    check: () => Result<void>,
    apply: () => Result<unknown>,
  ): Result<void> {
    return writeWith(options.commands, context, check, () =>
      inTransaction(db, 'timeline', () => {
        const again = check();
        return again.ok ? apply() : again;
      }),
    );
  }

  return {
    versions,

    async create(timeline, context) {
      const checked = validTimeline(timeline);
      if (!checked.ok) return checked;
      const now = db.clock();
      const stored: TimelineRow = {
        ...documentColumns(timeline, timeline.revision),
        id: timeline.id,
        projectId: timeline.projectId,
        createdAt: now,
        updatedAt: now,
      };
      const check = (): Result<void> => {
        if (row(timeline.id)) return err(ConflictError({ entity: 'timeline', id: timeline.id }));
        const project = orm
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, timeline.projectId))
          .get();
        return project ? ok(undefined) : err(NotFoundError({ entity: 'project', id: timeline.projectId }));
      };
      const saved = write(context, check, () => {
        orm.insert(timelines).values(stored).run();
        setRefs(timeline.id, stored.document);
        // The assembly's result is the first version, so "go back to what the agent made" always works.
        const first = versions.snapshot({
          timelineId: timeline.id,
          kind: 'auto',
          commandId: context?.commandId ?? null,
        });
        return first.ok ? ok(undefined) : first;
      });
      return saved.ok ? ok(toTimelineSummary(stored)) : saved;
    },

    async put(timeline, expectedRevision, context) {
      const checked = validTimeline(timeline);
      if (!checked.ok) return checked;
      const id = timeline.id;
      const check = (): Result<void> => {
        const current = row(id);
        if (!current) return missing(id);
        if (current.projectId !== timeline.projectId) return err(ValidationError({ field: 'projectId' }));
        return current.revision === expectedRevision
          ? ok(undefined)
          : err(ConflictError({ entity: 'timeline', id }, { detail: `revision is ${current.revision}` }));
      };
      const before = row(id);
      const now = db.clock();
      const columns = { ...documentColumns(timeline, expectedRevision + 1), updatedAt: now };
      const saved = write(context, check, () => {
        const stored = row(id);
        orm.update(timelines).set(columns).where(eq(timelines.id, id)).run();
        setRefs(id, columns.document);
        // EDT1-CMT: its comments move with their anchors, in this transaction.
        followCommentsOnWrite(db, stored, timeline, now);
        const auto = versions.autosave(id);
        return auto.ok ? ok(undefined) : auto;
      });
      if (!saved.ok) return saved;
      return ok(toTimelineSummary({ ...before!, ...columns }));
    },

    async get(id) {
      const stored = row(id);
      if (!stored) return missing(id);
      return ok({
        summary: toTimelineSummary(stored),
        schemaVersion: stored.schemaVersion,
        json: stored.document,
      });
    },

    async listByProject(projectId) {
      return ok(
        orm
          .select()
          .from(timelines)
          .where(eq(timelines.projectId, projectId))
          .orderBy(desc(timelines.updatedAt), desc(timelines.id))
          .all()
          .map(toTimelineSummary),
      );
    },

    async remove(id, context) {
      return write(
        context,
        () => (row(id) ? ok(undefined) : missing(id)),
        () => ok(orm.delete(timelines).where(eq(timelines.id, id)).run()),
      );
    },
  };
}

/** The document a version or the working copy holds, as a Timeline to put back (an older schema is upgraded first). */
export function asTimeline(json: unknown, schemaVersion: number): Result<Timeline> {
  return upgradeTimeline(json, schemaVersion);
}
