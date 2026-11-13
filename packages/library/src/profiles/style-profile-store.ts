// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's StyleProfileStore (LRN1-STY) over migration 31. Profiles are derived: `put` replaces a set's row, and a
 * row whose JSON no longer parses (an older algorithm) reads as absent, so it is rebuilt. A summary is written only
 * onto the profile it was written for (`setSummary` names the digest). A project's style is the person's choice:
 * `setProjectStyle` with a CommandContext is staged on the command's unit of work and commits with its audit row.
 */
import {
  err,
  NotFoundError,
  ok,
  parseStyleSourceKey,
  styleProfileSchema,
  styleSourceKey,
  styleProfileSummarySchema,
  type ProjectId,
  type Result,
  type StyleProfileRecord,
  type StyleProfileStore,
  type StyleSource,
} from '@taalcut/core';
import { and, eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { knownProject } from '../projects/known-project';
import { stagedWriter } from '../stores/staged-write';
import { styleMembers, styleSourceName } from './style-profile-members';
import { projectStyles, styleProfiles, type StyleProfileRow } from './style-profile-table';

export interface StyleProfileStoreOptions {
  /** createLibraryPorts(db).commands: a project's style commits with the command's audit row. */
  readonly commands?: CommandStager;
}

const ofSource = (source: StyleSource) => eq(styleProfiles.sourceKey, styleSourceKey(source));
const ofProject = (projectId: ProjectId) => eq(projectStyles.projectId, projectId);

/** The stored row as a record; null when it no longer parses (built by an older algorithm: rebuild it). */
function recordOf(row: StyleProfileRow): StyleProfileRecord | null {
  const source = parseStyleSourceKey(row.sourceKey);
  const summary = styleProfileSummarySchema.safeParse(row.summary);
  const profile = row.profile === null ? null : styleProfileSchema.safeParse(row.profile);
  if (!source || !summary.success || (profile !== null && !profile.success)) return null;
  return {
    source,
    digest: row.digest,
    profile: profile === null ? null : profile.data,
    summary: summary.data,
    builtAt: row.builtAt,
  };
}

/** The profiles: one row per set, replaced on each build. */
function profileRows(db: LibraryDatabase): Omit<StyleProfileStore, 'projectStyle' | 'setProjectStyle'> {
  const { orm } = db;
  return {
    async members(source) {
      return styleMembers(db, source);
    },

    async sourceName(source) {
      return styleSourceName(db, source);
    },

    async get(source) {
      const row = orm.select().from(styleProfiles).where(ofSource(source)).get();
      return ok(row ? recordOf(row) : null);
    },

    async list() {
      const rows = orm
        .select({ sourceKey: styleProfiles.sourceKey, digest: styleProfiles.digest })
        .from(styleProfiles)
        .orderBy(styleProfiles.sourceKey)
        .all();
      return ok(
        rows.flatMap((row) => {
          const source = parseStyleSourceKey(row.sourceKey);
          return source ? [{ source, digest: row.digest }] : [];
        }),
      );
    },

    async put(record) {
      const values = {
        sourceKey: styleSourceKey(record.source),
        digest: record.digest,
        profile: record.profile,
        summary: record.summary,
        builtAt: record.builtAt,
      };
      orm
        .insert(styleProfiles)
        .values(values)
        .onConflictDoUpdate({ target: styleProfiles.sourceKey, set: values })
        .run();
      return ok(undefined);
    },

    async setSummary(source, digest, summary) {
      const changed = orm
        .update(styleProfiles)
        .set({ summary })
        .where(and(ofSource(source), eq(styleProfiles.digest, digest)))
        .run();
      return ok(changed.changes > 0);
    },

    async remove(source) {
      orm.delete(styleProfiles).where(ofSource(source)).run();
      return ok(undefined);
    },
  };
}

/** Each project's style: the set it is made like, chosen by the person (styleProfile.use). */
function projectRows(
  db: LibraryDatabase,
  options: StyleProfileStoreOptions,
): Pick<StyleProfileStore, 'projectStyle' | 'setProjectStyle'> {
  const { orm } = db;
  const write = stagedWriter(db, options.commands, 'project_styles');
  const projectExists = (projectId: ProjectId): Result<void> =>
    knownProject(db, projectId) ? ok(undefined) : err(NotFoundError({ entity: 'project', id: projectId }));

  return {
    async projectStyle(projectId) {
      const row = orm
        .select({ sourceKey: projectStyles.sourceKey })
        .from(projectStyles)
        .where(ofProject(projectId))
        .get();
      return ok(row ? parseStyleSourceKey(row.sourceKey) : null);
    },

    async setProjectStyle(projectId, source: StyleSource | null, context) {
      return write(
        context,
        () => projectExists(projectId),
        () => {
          if (!source) {
            orm.delete(projectStyles).where(ofProject(projectId)).run();
            return;
          }
          const values = { projectId, sourceKey: styleSourceKey(source), updatedAt: db.clock() };
          orm
            .insert(projectStyles)
            .values(values)
            .onConflictDoUpdate({ target: projectStyles.projectId, set: values })
            .run();
        },
      );
    },
  };
}

export function createStyleProfileStore(
  db: LibraryDatabase,
  options: StyleProfileStoreOptions = {},
): StyleProfileStore {
  return { ...profileRows(db), ...projectRows(db, options) };
}
