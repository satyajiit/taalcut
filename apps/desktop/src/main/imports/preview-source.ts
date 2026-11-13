// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  err,
  importDraftSchema,
  ok,
  toTaalcutError,
  type AsyncResult,
  type ImportMethod,
} from '@taalcut/core';
import type { LibraryDatabase } from '@taalcut/library';
import type { ApplePhotosPort } from '../../platform/photos';
import { PhotosSelectionChanged, photosLocatorSchema } from './photos-state';

export interface ImportPreviewSource {
  readonly method: ImportMethod;
  readonly locator: unknown;
}

export function resolveImportPreview(
  db: LibraryDatabase,
  id: string,
): AsyncResult<ImportPreviewSource | null> {
  try {
    const row = db.driver
      .prepare(
        `SELECT d.body, i.locator FROM import_draft_items i
      JOIN import_drafts d ON d.id = i.draft_id WHERE i.id = ? LIMIT 1`,
      )
      .get(id);
    if (!row) return Promise.resolve(ok(null));
    const draft = importDraftSchema.parse(JSON.parse(String(row['body'])));
    return Promise.resolve(
      ok({ method: draft.method, locator: JSON.parse(String(row['locator'])) as unknown }),
    );
  } catch (cause) {
    return Promise.resolve(err(toTaalcutError(cause)));
  }
}

/** The only native operation a Photos preview can reach is the local-only thumbnail request. */
export function renderPhotosImportPreview(
  photos: ApplePhotosPort,
  locator: unknown,
  dest: string,
  signal: AbortSignal,
): AsyncResult<{ path: string | null }> {
  const parsed = photosLocatorSchema.safeParse(locator);
  return parsed.success
    ? photos.thumbnail(parsed.data.asset.id, dest, signal)
    : Promise.resolve(err(PhotosSelectionChanged()));
}
