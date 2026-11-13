// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1: the workspace's commands and its store. A write names files by content only: the tool puts each file's
 * bytes in the store first (`WorkspaceStore.putBlob`), then dispatches `workspace.writeFiles` with paths and
 * hashes, so the audit log and undo keep paths and hashes, never a file's text. Handlers: @taalcut/library. Both
 * join their project's history (an agent turn's group), so a design and its placing undo as one step.
 *
 * - writeFiles: a new revision over `baseRevision` (core.conflict when that isn't the head); each change writes a
 *   file (its blob must be in the store) or deletes one. Write; inverse `workspace.restore` with the base.
 * - restore: the workspace's head goes back (or forward again) to a revision it had: writeFiles' inverse, and the
 *   files viewer's Restore (a person's, source 'ui'); its own inverse is restore with the head it replaced.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type ProjectId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import { sha256Schema } from '../templates/template-parts';
import type { WorkspaceRevision } from './composition';
import { checkUniquePaths, WORKSPACE_LIMITS, workspacePathSchema, type WorkspaceFile } from './workspace-files';

export const WORKSPACE_COMMANDS = {
  /** write; inverse workspace.restore (the base revision). */
  writeFiles: 'workspace.writeFiles',
  /** writeFiles' inverse and its own; the files viewer's Restore dispatches it too (source 'ui'). */
  restore: 'workspace.restore',
} as const;

const projectId = idSchema<'Project'>();
/** A revision of the workspace; 0 is the empty workspace, before anything was written. */
const revision = z.int().min(0);

/** One change: a file's new content (by its blob's sha256), or the file gone. */
export const workspaceFileChangeSchema = z.union([
  z.strictObject({ path: workspacePathSchema, sha256: sha256Schema }),
  z.strictObject({ path: workspacePathSchema, delete: z.literal(true) }),
]);
export type WorkspaceFileChange = z.output<typeof workspaceFileChangeSchema>;

export const workspaceCommandPayloads = {
  [WORKSPACE_COMMANDS.writeFiles]: z
    .object({
      projectId,
      /** The head it was made on: another is core.conflict. */
      baseRevision: revision,
      files: z.array(workspaceFileChangeSchema).min(1).max(WORKSPACE_LIMITS.files),
    })
    .superRefine((payload, ctx) => checkUniquePaths(payload.files, ctx, 'files')),
  [WORKSPACE_COMMANDS.restore]: z.object({ projectId, revision }),
};
export type WorkspaceWriteFilesPayload = z.output<
  (typeof workspaceCommandPayloads)[typeof WORKSPACE_COMMANDS.writeFiles]
>;
export type WorkspaceRestorePayload = z.output<
  (typeof workspaceCommandPayloads)[typeof WORKSPACE_COMMANDS.restore]
>;

/** What both commands answer: the workspace's head after it. */
export const workspaceCommandResultSchema = z.object({ projectId, revision });
export type WorkspaceCommandResult = z.output<typeof workspaceCommandResultSchema>;

/**
 * The workspace's blobs and revisions, for the workspace tools (render) and the render worker's callers. The
 * library implements it over `<userData>/workspaces/<projectId>/` (`workspaceBlobPath`) and its SQLite, and
 * registers it as WorkspaceStoreToken in the agent process. Every write to the revisions is a WORKSPACE_COMMANDS
 * command; only blobs go in directly, and a blob no revision, timeline copy or template names is pruned.
 */
export interface WorkspaceStore {
  /** Keeps a file's bytes (once per sha256). core.validation over `WORKSPACE_LIMITS.fileBytes`. */
  putBlob(
    projectId: ProjectId,
    data: Uint8Array,
  ): AsyncResult<{ readonly sha256: string; readonly bytes: number }>;
  /** core.not_found (entity 'workspaceBlob'). */
  readBlob(projectId: ProjectId, sha256: string): AsyncResult<Uint8Array>;
  /** The head revision, or null for a workspace nothing was written to (revision 0). */
  head(projectId: ProjectId): AsyncResult<WorkspaceRevision | null>;
  /** core.not_found (entity 'workspaceRevision'). */
  revision(projectId: ProjectId, revision: number): AsyncResult<WorkspaceRevision>;
  /**
   * HFW1-UI: the newest `limit` revisions, newest first, for the files viewer's history (appContract.workspace).
   * Optional: without it the viewer's list reads them one by one with `revision`.
   */
  revisions?(projectId: ProjectId, limit: number): AsyncResult<WorkspaceRevision[]>;
  /**
   * HFW1-TPL: the templates' pool (`templateBlobPath`), apart from any project. A template's compositions keep their
   * files here (copied from the workspace they were designed in), since a project's folder goes with it; a make
   * reads them here and puts them into its own project (`putBlob`). A pooled blob no template version names is
   * pruned. Optional: without them a template keeps no compositions.
   */
  putTemplateBlob?(data: Uint8Array): AsyncResult<{ readonly sha256: string; readonly bytes: number }>;
  /** core.not_found (entity 'workspaceBlob'). */
  readTemplateBlob?(sha256: string): AsyncResult<Uint8Array>;
  /**
   * Persists a reserved `_taalcut/` file (such as `_taalcut/brief.md`) into the head's file list without advancing
   * the workspace revision number, so `workspace.exec` and subsequent reads see it on disk and at `head`.
   */
  writeReserved?(projectId: ProjectId, path: string, data: Uint8Array): AsyncResult<WorkspaceFile>;
  /** Reads a file's bytes from the head revision by its path. */
  readFile?(projectId: ProjectId, path: string): AsyncResult<Uint8Array>;
}

export const WorkspaceStoreToken = createToken<WorkspaceStore>('core.workspaceStore');
