// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The templates package's library errors (packages/templates errors.ts) as the fake sends them. Built as plain
 * TaalcutErrors, not with defineError: the codes belong to @taalcut/templates, which the window never loads.
 */
import type { TaalcutError } from '@taalcut/core';

function templatesError(code: string, params?: Record<string, string | number>): TaalcutError {
  return {
    code: `templates.${code}`,
    messageKey: `errors.templates.${code}`,
    retryable: false,
    ...(params ? { params } : {}),
  };
}

/** A tag that is not 1–32 letters, marks, digits and hyphens after normalisation. */
export const TagInvalid = (tag: string) =>
  templatesError('tag_invalid', { tag: tag.normalize('NFC').trim().slice(0, 32) });
export const FolderNotFound = () => templatesError('folder_not_found');
export const FolderNameTaken = () => templatesError('folder_name_taken');
/** One file in a batch failed; `file` is its index and nothing was imported. `problems` is JSON. */
export const ImportInvalid = (file: number, problems: readonly { path: string; rule: string }[]) =>
  templatesError('import_invalid', { file, problems: JSON.stringify(problems.slice(0, 50)) });
export const StyleNotFound = () => templatesError('style_not_found');
