// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The rules a workspace's file list keeps at every revision, beyond core's `workspacePathSchema` (which already
 * refuses `..`, absolute paths, dot segments and anything but plain ASCII names):
 *
 * - `_taalcut/` is Taalcut's: the Designer's brief is written there by trusted code, and no tool, client or person
 *   writes or deletes in it. It is matched in any case, since `_TAALCUT/brief.md` is the same folder on a Mac.
 * - No two paths that differ only in case (`Style.css`, `style.css`), and no path that is a file and a folder at
 *   once (`a` and `a/b.css`): either would be one file, or none, on a case-insensitive disk.
 * - At most `WORKSPACE_LIMITS.workspaceFiles` files and `workspaceBytes` bytes, each file at most `fileBytes`.
 */
import {
  err,
  NotFoundError,
  ok,
  ValidationError,
  WORKSPACE_LIMITS,
  type Result,
  type WorkspaceFile,
} from '@taalcut/core';

/** The folder only trusted code writes (`_taalcut/brief.md`). */
export const RESERVED_WORKSPACE_FOLDER = '_taalcut';

/** True for `_taalcut` and anything in it, in any case. */
export function isReservedWorkspacePath(path: string): boolean {
  return (path.split('/')[0] ?? '').toLowerCase() === RESERVED_WORKSPACE_FOLDER;
}

/** A change whose blob was found: what the new file is. */
export type ResolvedChange =
  | { readonly path: string; readonly sha256: string; readonly bytes: number }
  | { readonly path: string; readonly delete: true };

const refuse = (detail: string) => err(ValidationError({ field: 'files' }, { detail }));

/** The workspace's files after `changes`, sorted by path, or why that list can't be. */
export function applyWorkspaceChanges(
  current: readonly WorkspaceFile[],
  changes: readonly ResolvedChange[],
): Result<WorkspaceFile[]> {
  const files = new Map(current.map((file) => [file.path, file]));
  for (const change of changes) {
    if ('delete' in change) {
      if (!files.delete(change.path))
        return err(
          NotFoundError({ entity: 'workspaceFile', id: change.path }, { detail: 'There is no such file' }),
        );
    } else {
      if (change.bytes > WORKSPACE_LIMITS.fileBytes)
        return refuse(
          `${change.path} is ${change.bytes} bytes; a file holds at most ${WORKSPACE_LIMITS.fileBytes}`,
        );
      files.set(change.path, { path: change.path, sha256: change.sha256, bytes: change.bytes });
    }
  }
  const next = [...files.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const checked = checkWorkspaceFiles(next);
  return checked.ok ? ok(next) : checked;
}

/** The rules above, on a whole file list. */
export function checkWorkspaceFiles(files: readonly WorkspaceFile[]): Result<void> {
  if (files.length > WORKSPACE_LIMITS.workspaceFiles)
    return refuse(`${files.length} files; a workspace holds at most ${WORKSPACE_LIMITS.workspaceFiles}`);
  const total = files.reduce((sum, file) => sum + file.bytes, 0);
  if (total > WORKSPACE_LIMITS.workspaceBytes)
    return refuse(`${total} bytes in all; a workspace holds at most ${WORKSPACE_LIMITS.workspaceBytes}`);
  const byFolded = new Map<string, string>();
  for (const file of files) {
    const folded = file.path.toLowerCase();
    const other = byFolded.get(folded);
    if (other !== undefined && other !== file.path)
      return refuse(`${other} and ${file.path} differ only in case: name them apart`);
    byFolded.set(folded, file.path);
  }
  for (const file of files) {
    const segments = file.path.toLowerCase().split('/');
    for (let end = 1; end < segments.length; end += 1) {
      const folder = byFolded.get(segments.slice(0, end).join('/'));
      if (folder !== undefined) return refuse(`${folder} is a file, so ${file.path} can't be in it`);
    }
  }
  return ok(undefined);
}

/** Same paths with the same contents. */
export function sameWorkspaceFiles(a: readonly WorkspaceFile[], b: readonly WorkspaceFile[]): boolean {
  if (a.length !== b.length) return false;
  const byPath = new Map(a.map((file) => [file.path, file.sha256]));
  return b.every((file) => byPath.get(file.path) === file.sha256);
}
