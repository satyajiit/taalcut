// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Errors for adding and reading watched-folder sources (P1-G7). Each names
 * the folder for people in `name`: the source's label, or the folder's own
 * name, never a path ("The Diwali 2025 folder isn't on this Mac any more").
 */
import { basename } from 'node:path';
import { defineError } from '@taalcut/core';

type FolderParams = {
  readonly path: string;
  /** What to call the folder in a message: a source's label or the folder's name, never a path. */
  readonly name: string;
};

/** Nothing at that path (or it went away since it was added). */
export const FolderMissing = defineError<FolderParams>('library.folder_missing');
/** The path is a file, not a folder. */
export const NotAFolder = defineError<FolderParams>('library.not_a_folder');
/**
 * The folder can't be a source: not an absolute path, the whole disk, or
 * inside Taalcut's own data. `detail` says which.
 */
export const FolderNotAllowed = defineError<FolderParams>('library.folder_not_allowed');

/**
 * macOS refused to let Taalcut read the folder (Privacy & Security → Files and Folders, TCC). The fix
 * opens that pane.
 */
export const FolderPermissionDenied = defineError<FolderParams>('library.folder_permission_denied', {
  fix: { command: 'system.openFilesAndFolders', labelKey: 'fix.openFilesAndFolders' },
});
/** The file at the path changed (size or partial hash) since `library.findMissing` verified it. */
export const RelinkMismatch = defineError<{ readonly name: string }>('library.relink_mismatch');
/** A library holds at most MAX_SOURCES watched folders. */
export const TooManySources = defineError<{ readonly limit: number }>('library.too_many_sources');
/** No present copy of the asset to read (every location offline, missing or a placeholder); retried later. */
export const OriginalUnavailable = defineError<{ readonly name: string }>('library.original_unavailable', {
  retryable: true,
});

/** A folder's params: its path, and its name (the last part of the path; the path itself for the disk's root). */
export function folderParams(path: string, label?: string): FolderParams {
  const name = label?.trim() || basename(path.replace(/[\\/]+$/, '')) || path;
  return { path, name };
}
