// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { ALL_SAVED_COLLECTION_ID } from '@taalcut/core';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { SavedCollection } from '../../../../features/templates/saved/saved-collection';
import { SavedFrame } from '../../../../features/templates/saved/saved-page';
import { parseSavedSearch, type SavedSearch } from '../../../../features/templates/saved/saved-search';
import { useSaved } from '../../../../features/templates/saved/use-saved';
import { CollectionName } from '../../../../features/templates/saved/watch-bar';

/** One Saved collection (UX4 tpl): its reels, `?q=…&unlinked=1`. All Saved is /templates/saved. */
export const Route = createFileRoute('/_shell/templates/saved/$collectionId')({
  validateSearch: (search: Record<string, unknown>): Omit<SavedSearch, 'collection'> => {
    const { collection: _ignored, ...rest } = parseSavedSearch(search);
    return rest;
  },
  beforeLoad: ({ params, search }) => {
    if (params.collectionId === ALL_SAVED_COLLECTION_ID)
      throw redirect({ to: '/templates/saved', search, replace: true });
  },
  component: Collection,
});

function Collection() {
  const { collectionId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const saved = useSaved(collectionId, search);
  return (
    <SavedFrame
      saved={saved}
      {...(saved.active ? { detail: <CollectionName collection={saved.active} /> } : {})}
    >
      <SavedCollection
        key={collectionId}
        saved={saved}
        collectionId={collectionId}
        search={search}
        onSearch={(next) => {
          const { collection: _ignored, ...rest } = parseSavedSearch({ ...next });
          void navigate({ search: rest, replace: true });
        }}
      />
    </SavedFrame>
  );
}
