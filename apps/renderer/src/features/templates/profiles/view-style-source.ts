// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Which set of references a view of Templates shows whole (LRN1-STY), so its style profile can sit above the list:
 * a folder, with no words and no filter; or exactly one tag over every template, with no words and no other filter.
 * Any other view lists no one set (words list search results; several tags, a folder narrowed by a filter,
 * Favourites and Not in a folder are no set at all), so it has no card: the card's "these templates" are always the
 * list under it. A folder the rail doesn't know (still loading, or gone) has none either, and neither has a list
 * that is empty or still loading: the list's own empty state says what fills it, and one "nothing here" is enough.
 */
import type { StyleSource, TemplateFolder } from '@taalcut/core';
import { hasFilters, tagsOf, type TemplateSearch } from '../library/template-search';

export function styleSourceOfView(
  search: TemplateSearch,
  words: string,
  folders: readonly TemplateFolder[] | undefined,
  /** How many templates the list shows; undefined while it loads. */
  listed: number | undefined,
): StyleSource | null {
  if (words || !listed) return null;
  const { folder } = search;
  if (folder === 'favourites' || folder === 'unfiled') return null;
  if (folder) {
    const known = folders?.some((each) => each.id === folder) === true;
    return known && !hasFilters(search) ? { kind: 'folder', folderId: folder } : null;
  }
  const [tag, ...more] = tagsOf(search);
  const narrowed = Boolean(search.format || search.lang || search.length || search.stale);
  return tag && more.length === 0 && !narrowed ? { kind: 'tag', tag } : null;
}
