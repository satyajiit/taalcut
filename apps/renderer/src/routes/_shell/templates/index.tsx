// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  parseTemplateSearch,
  type TemplateSearch,
} from '../../../features/templates/library/template-search';
import { TemplatesPage } from '../../../features/templates/templates-page';

/** Your templates (UX4 tpl): `?q=…&tags=…&format=…&lang=…&length=…&stale=true&sort=…&dir=…`. */
export const Route = createFileRoute('/_shell/templates/')({
  // A crumb: a template, a folder and the other views show "Templates ›" (shell/nav).
  staticData: { crumb: msg`Templates` },
  validateSearch: (search: Record<string, unknown>): TemplateSearch => parseTemplateSearch(search),
  // A folder was a search value before it had a URL of its own (`?folder=…`, in chats and cards): it lands there.
  beforeLoad: ({ search }) => {
    if (search.folder)
      throw redirect({
        to: '/templates/folders/$folderId',
        params: { folderId: search.folder },
        search: { ...search, folder: undefined },
        replace: true,
      });
  },
  component: Templates,
});

function Templates() {
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/templates/' });
  return (
    <TemplatesPage
      search={search}
      // Typing and filtering replace the entry, so Back leaves the view instead of undoing each letter.
      onSearch={(next, replace) => void navigate({ search: (prev) => ({ ...prev, ...next }), replace })}
    />
  );
}
