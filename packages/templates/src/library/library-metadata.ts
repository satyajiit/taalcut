// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Whether the registered TemplateStore serves P3-V14's library metadata: keeps tags, folders, favourites, trend
 * dates and provenance (on `setMeta`, and on `create`: a starter, a file import or a hub fork), and filters and
 * sorts `list` by them. A store that doesn't (the library's SQLite store until it has the columns) would answer
 * `ok` with the change dropped, the fork reading as the person's own, or the page unfiltered, so the service and
 * the commands that write them refuse first: core.not_implemented, feature `templates.library`.
 */
import { err, NotImplementedError, type Result, type TemplateListQuery } from '@taalcut/core';

export const LIBRARY_FEATURE = 'templates.library';

/** The query fields only a library-metadata store can serve. Absent `sort` is Phase 2's recent-first order. */
export function usesLibraryQuery(query: TemplateListQuery): boolean {
  return (
    (query.tags !== undefined && query.tags.length > 0) ||
    query.folderId !== undefined ||
    query.favourite !== undefined ||
    query.formatId !== undefined ||
    query.language !== undefined ||
    query.origin !== undefined ||
    query.stale !== undefined ||
    query.sort !== undefined ||
    query.dir !== undefined
  );
}

export function libraryNotServed(): Result<never> {
  return err(NotImplementedError({ feature: LIBRARY_FEATURE }));
}
