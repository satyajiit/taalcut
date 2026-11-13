// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { ImportDraft, ImportItem } from '@taalcut/core';

export function itemSelected(draft: ImportDraft, item: ImportItem): boolean {
  return (
    (!draft.onlyNew || !item.duplicate) &&
    (draft.selectAll ? !draft.excludedIds.includes(item.id) : draft.selectedIds.includes(item.id))
  );
}
/** A range uses the last explicit choice as its anchor, including across loaded pages. */
export function selectItems(
  draft: ImportDraft,
  items: readonly ImportItem[],
  index: number,
  anchor: number,
  range: boolean,
) {
  const item = items[index];
  if (!item) return {};
  const checked = !itemSelected(draft, item);
  const affected = range ? items.slice(Math.min(index, anchor), Math.max(index, anchor) + 1) : [item];
  const ids = new Set(draft.selectAll ? draft.excludedIds : draft.selectedIds);
  for (const each of affected) {
    if (draft.onlyNew && each.duplicate) continue;
    if (checked !== draft.selectAll) ids.add(each.id);
    else ids.delete(each.id);
  }
  return draft.selectAll ? { excludedIds: [...ids] } : { selectedIds: [...ids] };
}
