// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { TemplateSearchQuery } from '@taalcut/core';
import { listQueryOf, type TemplateSearch } from '../library/template-search';

/**
 * The page's view as a search's scope: the folder (or favourites, or no folder), tags, format, language and trend
 * filter it narrows the library to, as the list reads them, applied in the search before its limit so the count is
 * every match (LRN1-FIX). Length is the window's filter on the whole answer, as it is on the list (neither query
 * takes one), and the sort isn't a filter: results rank by how well they match.
 */
export function searchScopeOf(search: TemplateSearch): Partial<TemplateSearchQuery> {
  const { favourite, folderId, tags, formatId, language, stale } = listQueryOf(search);
  return {
    ...(favourite === undefined ? {} : { favourite }),
    ...(folderId === undefined ? {} : { folderId }),
    ...(tags ? { tags } : {}),
    ...(formatId ? { formatId } : {}),
    ...(language ? { language } : {}),
    ...(stale ? { stale } : {}),
  };
}
