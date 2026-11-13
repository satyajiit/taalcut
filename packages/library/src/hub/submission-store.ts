// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's HubSubmissionStore (P3-B12) over migration 21: the templates this install shared. `record` with a
 * CommandContext is staged on the command's unit of work (hub.publish), so the row commits with the audit
 * entry; a redo that records the same submission again replaces it. Rows are validated with core's
 * hubSubmissionViewSchema on the way in and on the way out.
 */
import {
  err,
  hubSubmissionViewSchema,
  ok,
  SUBMISSION_STATES,
  ValidationError,
  type CommandContext,
  type HubSubmissionId,
  type HubSubmissionStore,
  type HubSubmissionView,
  type HubTemplateId,
  type Result,
  type SubmissionState,
  type TemplateId,
} from '@taalcut/core';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { writeWith, type CommandStager } from '../ports/staging';
import { attemptWrite, inTransaction, touched } from '../repositories/shared';
import { hubSubmissions } from '../schema/hub';

export interface HubSubmissionStoreOptions {
  /** createLibraryPorts(db).commands: a record with a context commits with the command's audit row. */
  readonly commands?: CommandStager;
}

type Row = typeof hubSubmissions.$inferSelect;

const ENTITY = 'hub_submission';

function invalid(field: string, error: z.ZodError): Result<never> {
  return err(ValidationError({ field }, { detail: z.prettifyError(error).slice(0, 2000) }));
}

/** A row as core's view; a row that no longer parses is an error, never a guess. */
function toView(row: Row): Result<HubSubmissionView> {
  const parsed = hubSubmissionViewSchema.safeParse(row);
  return parsed.success ? ok(parsed.data) : invalid(ENTITY, parsed.error);
}

function toViews(rows: readonly Row[]): Result<HubSubmissionView[]> {
  const views: HubSubmissionView[] = [];
  for (const row of rows) {
    const view = toView(row);
    if (!view.ok) return view;
    views.push(view.value);
  }
  return ok(views);
}

export function createHubSubmissionStore(
  db: LibraryDatabase,
  options: HubSubmissionStoreOptions = {},
): HubSubmissionStore {
  const { orm } = db;

  function record(submission: HubSubmissionView, context?: CommandContext): Result<void> {
    const parsed = hubSubmissionViewSchema.safeParse(submission);
    if (!parsed.success) return invalid('submission', parsed.error);
    const row = parsed.data;
    const { id: _id, ...update } = row;
    return writeWith(
      options.commands,
      context,
      () => ok(undefined),
      () =>
        inTransaction(db, ENTITY, () =>
          attemptWrite(db, ENTITY, () =>
            orm
              .insert(hubSubmissions)
              .values(row)
              .onConflictDoUpdate({ target: hubSubmissions.id, set: update })
              .run(),
          ),
        ),
    );
  }

  function setState(id: HubSubmissionId, state: SubmissionState, checkedAt: number): Result<void> {
    if (!SUBMISSION_STATES.includes(state)) return err(ValidationError({ field: 'state' }));
    if (!Number.isSafeInteger(checkedAt) || checkedAt < 0)
      return err(ValidationError({ field: 'checkedAt' }));
    const changed = attemptWrite(
      db,
      ENTITY,
      () =>
        orm.update(hubSubmissions).set({ state, checkedAt }).where(eq(hubSubmissions.id, id)).run().changes,
    );
    return changed.ok ? touched(changed.value, ENTITY, id) : changed;
  }

  function list(filter: { readonly templateId?: TemplateId }): Result<HubSubmissionView[]> {
    const rows = orm
      .select()
      .from(hubSubmissions)
      .where(filter.templateId === undefined ? undefined : eq(hubSubmissions.templateId, filter.templateId))
      .orderBy(desc(hubSubmissions.createdAt), desc(hubSubmissions.id))
      .all();
    return toViews(rows);
  }

  function latestFor(
    templateId: TemplateId,
  ): Result<{ readonly hubId: HubTemplateId; readonly version: number } | null> {
    const row = orm
      .select()
      .from(hubSubmissions)
      .where(eq(hubSubmissions.templateId, templateId))
      .orderBy(desc(hubSubmissions.version), desc(hubSubmissions.createdAt), desc(hubSubmissions.id))
      .limit(1)
      .get();
    if (!row) return ok(null);
    const view = toView(row);
    return view.ok ? ok({ hubId: view.value.hubId, version: view.value.version }) : view;
  }

  return {
    record: async (submission, context) => record(submission, context),
    setState: async (id, state, checkedAt) => setState(id, state, checkedAt),
    list: async (filter) => list(filter),
    latestFor: async (templateId) => latestFor(templateId),
  };
}
