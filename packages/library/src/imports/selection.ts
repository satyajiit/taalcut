// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ImportDraft, ImportItemOutcome, ImportProgress } from '@taalcut/core';
import type { PreparedImportItem } from './adapter';

export function selectedImportItems(draft: ImportDraft, items: readonly PreparedImportItem[]) {
  const included = new Set(draft.selectedIds);
  const excluded = new Set(draft.excludedIds);
  return items.filter(
    ({ item }) =>
      (draft.selectAll ? !excluded.has(item.id) : included.has(item.id)) &&
      (!draft.onlyNew || !item.duplicate),
  );
}
export const finishedImportItem = (item: ImportItemOutcome) =>
  ['imported', 'duplicate', 'archived'].includes(item.state);
export function importCounts(
  items: readonly ImportItemOutcome[],
): Pick<ImportProgress, 'completedItems' | 'failedItems' | 'skippedItems' | 'archivedItems'> {
  return {
    completedItems: items.filter((item) => item.state === 'imported').length,
    failedItems: items.filter((item) => item.state === 'failed').length,
    skippedItems: items.filter((item) => item.state === 'duplicate').length,
    archivedItems: items.filter((item) => item.state === 'archived').length,
  };
}
export function importPage<T>(items: readonly T[], cursor?: string, limit = 100) {
  const parsed = cursor ? Number(cursor) : 0;
  const start = Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
  const size = Math.max(1, Math.min(limit, 200));
  const next = start + size;
  return { items: items.slice(start, next), ...(next < items.length ? { nextCursor: String(next) } : {}) };
}
