// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether the user paused indexing (`indexing.pause`), kept in settings so it
 * survives restarts, and the import status any process can read straight
 * from the database (the agent's `library.importStatus` tool needs no IPC).
 */
import { defineSetting, type IndexingStatus, type SourceId } from '@taalcut/core';
import { z } from 'zod';
import type { LibraryDatabase } from '../db/database';
import { createSettingsRepository } from '../repositories/settings';
import { indexingStatus } from './status';

export const INDEXING_PAUSED_SETTING = defineSetting('library.indexingPaused', z.boolean(), false);

export function isIndexingPaused(db: LibraryDatabase): boolean {
  const stored = createSettingsRepository(db).get(
    INDEXING_PAUSED_SETTING.key,
    INDEXING_PAUSED_SETTING.schema,
  );
  return stored.ok
    ? (stored.value ?? INDEXING_PAUSED_SETTING.defaultValue)
    : INDEXING_PAUSED_SETTING.defaultValue;
}

/**
 * Indexing status from the stage rows (one source always included when given), for processes without
 * the pipeline. `order`: stage names in pipeline order; default the SPEC's recommended order.
 */
export function readImportStatus(
  db: LibraryDatabase,
  options: { readonly sourceId?: SourceId; readonly order?: readonly string[] } = {},
): IndexingStatus {
  return indexingStatus(db, {
    paused: isIndexingPaused(db),
    ...(options.sourceId ? { sourceId: options.sourceId } : {}),
    ...(options.order ? { order: options.order } : {}),
  });
}
