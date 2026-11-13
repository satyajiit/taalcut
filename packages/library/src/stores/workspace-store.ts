// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's WorkspaceStore (HFW1-WS) over migration 41 and the blob folder (workspace-blobs.ts). Blobs go in
 * directly (`putBlob`); revisions and the head change only through WORKSPACE_COMMANDS (workspace-commands.ts),
 * whose handlers call `commit` and `moveHead` with their context, so the write is staged on the command's unit
 * of work and commits with its audit row or not at all. Each staged write checks again, in its transaction, that
 * the head and the newest revision are still what the handler read, so a stale write never commits.
 */
import {
  ConflictError,
  err,
  NotFoundError,
  ok,
  TEMPLATE_BLOBS_SCOPE,
  workspacePathSchema,
  workspaceRevisionSchema,
  type AsyncResult,
  type CommandContext,
  type CommandId,
  type ProjectId,
  type Result,
  type WorkspaceFile,
  type WorkspaceRevision,
  type WorkspaceStore,
  ValidationError,
} from '@taalcut/core';
import { and, desc, eq } from 'drizzle-orm';
import type { LibraryDatabase } from '../db/database';
import type { CommandStager } from '../ports/staging';
import { projects } from '../schema/chat';
import { stagedWriter } from './staged-write';
import { createWorkspaceBlobs, type WorkspaceBlobs } from './workspace-blobs';
import { checkWorkspaceFiles, isReservedWorkspacePath } from './workspace-paths';
import { pruneWorkspaces, type WorkspacePruneOptions, type WorkspacePruneReport } from './workspace-prune';
import { workspaceHeads, workspaceRevisions, type WorkspaceRevisionRow } from './workspace-table';

/** The most revisions one `revisions` call reads. */
const MAX_REVISIONS_LISTED = 500;

export interface WorkspaceStoreOptions {
  /** The app's user-data folder: blobs go in `<dataRoot>/workspaces/<projectId>/blobs/`. */
  readonly dataRoot: string;
  /** createLibraryPorts(db).commands: a command's revision commits with its audit row. */
  readonly commands?: CommandStager;
}

/** What a handler read before it wrote: the write commits only if both still hold. */
export interface WorkspaceExpectation {
  readonly head: number;
  readonly latest: number;
}

export interface LibraryWorkspaceStore extends WorkspaceStore {
  readonly blobs: WorkspaceBlobs;
  /** The newest `limit` revisions (at most 500), newest first: the files viewer's history. */
  revisions(projectId: ProjectId, limit: number): AsyncResult<WorkspaceRevision[]>;
  /** Whether the project is in the library. */
  hasProject(projectId: ProjectId): boolean;
  /** The head and the newest revision's number (0 and 0 for a workspace nothing was written to). */
  position(projectId: ProjectId): WorkspaceExpectation;
  /** The revision a `workspace.writeFiles` made, for its redo; null when it made none. */
  madeBy(commandId: CommandId): Result<WorkspaceRevision | null>;
  /** Adds `revision` (the next after `expected.latest`) and makes it the head. */
  commit(
    context: CommandContext | undefined,
    revision: WorkspaceRevision,
    expected: WorkspaceExpectation,
  ): Result<void>;
  /** Makes `revision` (0: the empty workspace) the head, from `expected.head`. */
  moveHead(
    context: CommandContext | undefined,
    projectId: ProjectId,
    revision: number,
    expected: WorkspaceExpectation,
  ): Result<void>;
  /** Deletes blobs nothing names and the folders of projects that are gone (workspace-prune.ts). */
  prune(options?: WorkspacePruneOptions): AsyncResult<WorkspacePruneReport>;
}

function toRevision(row: WorkspaceRevisionRow): Result<WorkspaceRevision> {
  const parsed = workspaceRevisionSchema.safeParse({
    projectId: row.projectId,
    revision: row.revision,
    base: row.base,
    files: row.files,
    createdAt: row.createdAt,
    origin: row.origin,
  });
  return parsed.success
    ? ok(parsed.data)
    : err(NotFoundError({ entity: 'workspaceRevision', id: `${row.revision}` }, { detail: 'unreadable' }));
}

export function createWorkspaceStore(
  db: LibraryDatabase,
  options: WorkspaceStoreOptions,
): LibraryWorkspaceStore {
  const { orm } = db;
  const blobs = createWorkspaceBlobs(options.dataRoot);
  const write = stagedWriter(db, options.commands, 'workspaceRevision');
  const reservedFiles = new Map<string, Map<string, WorkspaceFile>>();

  const hasProject = (projectId: ProjectId) =>
    orm.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).get() !== undefined;

  function position(projectId: ProjectId): WorkspaceExpectation {
    const head = orm
      .select({ revision: workspaceHeads.revision })
      .from(workspaceHeads)
      .where(eq(workspaceHeads.projectId, projectId))
      .get();
    const latest = orm
      .select({ revision: workspaceRevisions.revision })
      .from(workspaceRevisions)
      .where(eq(workspaceRevisions.projectId, projectId))
      .orderBy(desc(workspaceRevisions.revision))
      .limit(1)
      .get();
    return { head: head?.revision ?? 0, latest: latest?.revision ?? 0 };
  }

  /** Still where the handler found it: else the head moved under it, and the conflict names where it is now. */
  const unmoved = (projectId: ProjectId, expected: WorkspaceExpectation) => (): Result<void> => {
    const now = position(projectId);
    if (now.head === expected.head && now.latest === expected.latest) return ok(undefined);
    return err(
      ConflictError(
        { entity: 'workspaceRevision', id: `${now.head}` },
        { detail: `The workspace moved to revision ${now.head} meanwhile` },
      ),
    );
  };

  function setHead(projectId: ProjectId, revision: number): void {
    const updatedAt = db.clock();
    orm
      .insert(workspaceHeads)
      .values({ projectId, revision, updatedAt })
      .onConflictDoUpdate({ target: workspaceHeads.projectId, set: { revision, updatedAt } })
      .run();
  }

  const madeByRow = (commandId: CommandId) =>
    orm.select().from(workspaceRevisions).where(eq(workspaceRevisions.commandId, commandId)).get();

  async function revision(projectId: ProjectId, number: number): AsyncResult<WorkspaceRevision> {
    const row = orm
      .select()
      .from(workspaceRevisions)
      .where(and(eq(workspaceRevisions.projectId, projectId), eq(workspaceRevisions.revision, number)))
      .get();
    if (!row) return err(NotFoundError({ entity: 'workspaceRevision', id: `${number}` }));
    return toRevision(row);
  }

  return {
    blobs,
    hasProject,
    position,

    async putBlob(projectId, data) {
      if (!hasProject(projectId)) return err(NotFoundError({ entity: 'project', id: projectId }));
      return blobs.put(projectId, data);
    },

    readBlob: (projectId, sha256) => blobs.read(projectId, sha256),

    // HFW1-TPL: the templates' pool, apart from any project.
    putTemplateBlob: (data) => blobs.put(TEMPLATE_BLOBS_SCOPE, data),
    readTemplateBlob: (sha256) => blobs.read(TEMPLATE_BLOBS_SCOPE, sha256),

    async head(projectId) {
      const { head } = position(projectId);
      const reserved = reservedFiles.get(projectId);
      if (head === 0) {
        if (!reserved || reserved.size === 0) return ok(null);
        return ok({
          projectId,
          revision: 0,
          base: 0,
          files: [...reserved.values()],
          createdAt: db.clock(),
          origin: 'agent',
        } as unknown as WorkspaceRevision);
      }
      const current = await revision(projectId, head);
      if (!current.ok || !reserved || reserved.size === 0) return current;
      const merged = new Map(current.value.files.map((file) => [file.path, file]));
      for (const [path, file] of reserved) merged.set(path, file);
      return ok({ ...current.value, files: [...merged.values()] });
    },

    async writeReserved(projectId, path, data) {
      if (!workspacePathSchema.safeParse(path).success || !path.includes('/') || !isReservedWorkspacePath(path))
        return err(ValidationError({ field: 'path' }, { detail: 'Only _taalcut/ paths' }));
      if (!hasProject(projectId)) return err(NotFoundError({ entity: 'project', id: projectId }));
      const put = await blobs.put(projectId, data);
      if (!put.ok) return put;
      const file: WorkspaceFile = { path, sha256: put.value.sha256, bytes: put.value.bytes };
      const projectReserved = reservedFiles.get(projectId) ?? new Map<string, WorkspaceFile>();
      projectReserved.set(path, file);
      reservedFiles.set(projectId, projectReserved);
      return ok(file);
    },

    async readFile(projectId, path) {
      const current = await this.head(projectId);
      if (!current.ok) return current;
      const file = current.value?.files.find((entry) => entry.path === path);
      if (!file) return err(NotFoundError({ entity: 'workspaceFile', id: path }));
      return blobs.read(projectId, file.sha256);
    },

    revision,

    async revisions(projectId, limit) {
      const rows = orm
        .select()
        .from(workspaceRevisions)
        .where(eq(workspaceRevisions.projectId, projectId))
        .orderBy(desc(workspaceRevisions.revision))
        .limit(Math.max(0, Math.min(limit, MAX_REVISIONS_LISTED)))
        .all();
      const revisions: WorkspaceRevision[] = [];
      for (const row of rows) {
        const parsed = toRevision(row);
        if (!parsed.ok) return parsed;
        revisions.push(parsed.value);
      }
      return ok(revisions);
    },

    madeBy(commandId) {
      const row = madeByRow(commandId);
      return row ? toRevision(row) : ok(null);
    },

    commit(context, next, expected) {
      const parsed = workspaceRevisionSchema.safeParse(next);
      if (!parsed.success || next.revision !== expected.latest + 1 || next.base !== expected.head)
        return err(
          ValidationError({ field: 'revision' }, { detail: `revision ${next.revision} over ${next.base}` }),
        );
      const files = checkWorkspaceFiles(parsed.data.files);
      if (!files.ok) return files;
      const value = parsed.data;
      return write(context, unmoved(value.projectId, expected), () => {
        orm
          .insert(workspaceRevisions)
          .values({
            projectId: value.projectId,
            revision: value.revision,
            base: value.base,
            files: value.files,
            fileCount: value.files.length,
            bytes: value.files.reduce((sum, file) => sum + file.bytes, 0),
            origin: value.origin,
            // A redo that couldn't reuse its revision makes another, under no command: the first keeps the id.
            commandId: context && !madeByRow(context.commandId) ? context.commandId : null,
            createdAt: value.createdAt,
          })
          .run();
        setHead(value.projectId, value.revision);
      });
    },

    moveHead(context, projectId, number, expected) {
      const exists = (): Result<void> => {
        const moved = unmoved(projectId, expected)();
        if (!moved.ok || number === 0) return moved;
        const row = orm
          .select({ revision: workspaceRevisions.revision })
          .from(workspaceRevisions)
          .where(and(eq(workspaceRevisions.projectId, projectId), eq(workspaceRevisions.revision, number)))
          .get();
        return row ? ok(undefined) : err(NotFoundError({ entity: 'workspaceRevision', id: `${number}` }));
      };
      return write(context, exists, () => setHead(projectId, number));
    },

    prune: (pruneOptions) => pruneWorkspaces(db, options.dataRoot, pruneOptions),
  };
}
