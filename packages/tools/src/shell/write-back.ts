// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What a shell command changed in `work/` becomes a new workspace revision (AGT2 sbx) the way every workspace tool
 * writes one: each file's bytes into the store first, then `workspace.writeFiles` with paths and hashes over the
 * head it was checked out at, so undo and the audit log keep paths and hashes, never a file's text. A command
 * may change more files than one write takes (32): they go as several writes, each over the last, in one turn, so
 * they undo together. If the head moved while the command ran (another tool wrote), the write is made over the
 * new head when none of its paths changed there; otherwise it is core.conflict and nothing of it is written.
 */
import {
  ConflictError,
  err,
  ok,
  ValidationError,
  WORKSPACE_LIMITS,
  type AsyncResult,
  type ProjectId,
  type WorkspaceStore,
} from '@taalcut/core';
import type { CheckedOut, WorkChange } from './checkout';

export type Dispatch = (payload: unknown) => AsyncResult<unknown>;

const revisionOf = (value: unknown): number | null => {
  const revision = (value as { revision?: unknown } | null)?.revision;
  return typeof revision === 'number' ? revision : null;
};

/** Whether `paths` are the same at the store's head as they were in `base`. */
async function untouchedSince(
  store: WorkspaceStore,
  projectId: ProjectId,
  base: CheckedOut,
  paths: readonly string[],
): AsyncResult<number | null> {
  const head = await store.head(projectId);
  if (!head.ok) return head;
  const now = new Map((head.value?.files ?? []).map((file) => [file.path, file.sha256]));
  const same = paths.every((path) => now.get(path) === base.files.get(path)?.sha256);
  return ok(same ? (head.value?.revision ?? 0) : null);
}

/** Writes the changes; answers the new head revision (the base's when there were none). */
export async function writeBack(
  store: WorkspaceStore,
  dispatch: Dispatch,
  projectId: ProjectId,
  base: CheckedOut,
  changes: readonly WorkChange[],
): AsyncResult<number> {
  let revision = base.revision;
  const batches: WorkChange[][] = [];
  for (let at = 0; at < changes.length; at += WORKSPACE_LIMITS.files)
    batches.push(changes.slice(at, at + WORKSPACE_LIMITS.files));
  for (const [index, batch] of batches.entries()) {
    const files: ({ path: string; sha256: string } | { path: string; delete: true })[] = [];
    for (const change of batch) {
      if (change.change === 'deleted') {
        files.push({ path: change.path, delete: true });
        continue;
      }
      const put = await store.putBlob(projectId, change.data);
      if (!put.ok) return put;
      files.push({ path: change.path, sha256: put.value.sha256 });
    }
    let done = await dispatch({ projectId, baseRevision: revision, files });
    if (!done.ok && done.error.code === ConflictError.code && index === 0) {
      const moved = await untouchedSince(
        store,
        projectId,
        base,
        changes.map((change) => change.path),
      );
      if (!moved.ok) return moved;
      if (moved.value === null)
        return err(
          ConflictError(
            { entity: 'workspace' },
            { detail: 'Another tool changed the same files while the command ran: run it again.' },
          ),
        );
      revision = moved.value;
      done = await dispatch({ projectId, baseRevision: revision, files });
    }
    if (!done.ok) return done;
    const next = revisionOf(done.value);
    if (next === null)
      return err(
        ValidationError({ field: 'revision' }, { detail: 'workspace.writeFiles answered no revision' }),
      );
    revision = next;
  }
  return ok(revision);
}
