// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The two folder errors core's TemplateFolderStore contract names (`templates.folder_name_taken`,
 * `templates.folder_not_found`). @taalcut/templates defines them, and the library may not import it, so the
 * store returns the same plain error values (errors are data, so they cross IPC): `FolderNameTaken.is` and the
 * renderer's words for them match.
 */
import type { TaalcutError } from '@taalcut/core';

const templatesError = (code: string): TaalcutError => ({
  code,
  messageKey: `errors.${code}`,
  retryable: false,
});

export const folderNameTaken = (): TaalcutError => templatesError('templates.folder_name_taken');
export const folderNotFound = (): TaalcutError => templatesError('templates.folder_not_found');

/** What makes two folder names the same folder: NFC and lower case, in any script. */
export function folderNameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}
