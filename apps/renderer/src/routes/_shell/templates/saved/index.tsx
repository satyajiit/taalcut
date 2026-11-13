// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { ALL_SAVED_COLLECTION_ID } from '@taalcut/core';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { SavedCollection } from '../../../../features/templates/saved/saved-collection';
import { SavedFrame } from '../../../../features/templates/saved/saved-page';
import { parseSavedSearch, type SavedSearch } from '../../../../features/templates/saved/saved-search';
import { useSaved } from '../../../../features/templates/saved/use-saved';

/**
 * Saved on Instagram (`/templates/saved`): All Saved, `?q=…&unlinked=1`. A collection is its own page
 * (UX4 tpl), so `?collection=…`, its old place, lands there.
 */
export const Route = createFileRoute('/_shell/templates/saved/')({
  // A crumb: a collection and the settings read "Templates › Saved › Reels Inspo" (shell/nav). Short, because a crumb
  // is never cut and "Guardado en Instagram" overran the bar's 224 px; the views row still says "Saved on Instagram".
  staticData: { crumb: msg({ message: 'Saved', context: 'Instagram’s saved reels, as a crumb' }) },
  validateSearch: (search: Record<string, unknown>): SavedSearch => parseSavedSearch(search),
  beforeLoad: ({ search }) => {
    const { collection, ...rest } = search;
    if (collection)
      throw redirect({
        to: '/templates/saved/$collectionId',
        params: { collectionId: collection },
        search: rest,
        replace: true,
      });
  },
  component: AllSaved,
});

function AllSaved() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const saved = useSaved(ALL_SAVED_COLLECTION_ID, search);
  return (
    <SavedFrame saved={saved} warning={search.warning}>
      <SavedCollection
        saved={saved}
        collectionId={ALL_SAVED_COLLECTION_ID}
        search={search}
        onSearch={(next) => void navigate({ search: parseSavedSearch({ ...next }), replace: true })}
      />
    </SavedFrame>
  );
}
