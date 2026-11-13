// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, notFound, useNavigate } from '@tanstack/react-router';
import type { TemplateFolderId } from '@taalcut/core';
import {
  LIBRARY_VIEWS,
  parseTemplateSearch,
  type LibraryView,
  type TemplateSearch,
} from '../../../../features/templates/library/template-search';
import { TemplatesPage } from '../../../../features/templates/templates-page';
import { routeId } from '../../../../shell/route-id';

/** A place in your templates: Favourites, "Not in a folder", or one of your folders by its id. */
function parsePlace(value: string): LibraryView | TemplateFolderId {
  if ((LIBRARY_VIEWS as readonly string[]).includes(value)) return value as LibraryView;
  const id = routeId<'TemplateFolder'>(value);
  if (!id) throw notFound();
  return id;
}

/** One folder of your templates (UX4 tpl), with the list's search: the folder is the path, so Back works. */
export const Route = createFileRoute('/_shell/templates/folders/$folderId')({
  params: {
    parse: ({ folderId }) => ({ folderId: parsePlace(folderId) }),
    stringify: ({ folderId }) => ({ folderId }),
  },
  validateSearch: (search: Record<string, unknown>): TemplateSearch => ({
    ...parseTemplateSearch(search),
    folder: undefined,
  }),
  component: Folder,
});

function Folder() {
  const { folderId } = Route.useParams();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/templates/folders/$folderId' });
  return (
    <TemplatesPage
      // A folder of its own: a remount starts its list afresh (its selection and scroll are the folder's).
      key={folderId}
      search={{ ...search, folder: folderId }}
      onSearch={(next, replace) =>
        void navigate({ search: (prev) => ({ ...prev, ...next, folder: undefined }), replace })
      }
    />
  );
}
