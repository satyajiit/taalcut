// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * URL search state for Saved on Instagram (`/templates/saved` and `/templates/saved/$collectionId`): `?q=…&unlinked=1`.
 * The collection is the path (UX4 tpl); `?collection=…`, its old place, is read only to land on its page.
 */
import { ALL_SAVED_COLLECTION_ID, type InstagramReelsQuery } from '@taalcut/core';

export interface SavedSearch {
  readonly collection?: string | undefined;
  readonly q?: string | undefined;
  readonly unlinked?: boolean | undefined;
  /** `?warning=<feature>` (Settings › Accounts, the agent's settings.openSignInWarning): open the sign-in's warning. */
  readonly warning?: string | undefined;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 200) : '');

export function parseSavedSearch(search: Record<string, unknown>): SavedSearch {
  const collection = text(search.collection);
  const q = text(search.q);
  const unlinked = search.unlinked === true || search.unlinked === 'true' || search.unlinked === '1';
  const warning = text(search.warning);
  return {
    collection: collection && collection !== ALL_SAVED_COLLECTION_ID ? collection : undefined,
    q: q || undefined,
    unlinked: unlinked ? true : undefined,
    warning: warning || undefined,
  };
}

export function reelsQueryOf(
  collectionId: string,
  search: SavedSearch,
  cursor?: string,
): InstagramReelsQuery {
  return {
    collectionId,
    ...(search.q ? { query: search.q } : {}),
    onlyUnlinked: search.unlinked ?? false,
    limit: 50,
    ...(cursor ? { cursor } : {}),
  };
}

export function isSavedFiltered(search: SavedSearch): boolean {
  return !!(search.q || search.unlinked);
}
