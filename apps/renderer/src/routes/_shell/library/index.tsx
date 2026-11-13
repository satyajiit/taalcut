// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { LibraryActions } from '../../../features/library/library-actions';
import { ActiveImports } from '../../../features/library/imports/active-imports';
import { ImportDrop } from '../../../features/library/imports/import-drop';
import { LibraryViews } from '../../../features/library/imports/library-views';
import { LibraryPage } from '../../../features/library/library-page';
import { parseLibrarySearch, type LibrarySearch } from '../../../features/library/library-search';
import { Page } from '../../../shell/page';

export const Route = createFileRoute('/_shell/library/')({
  // A crumb: the clip page, From your phone and anything else under /library show "Library ›" (shell/nav).
  staticData: { crumb: msg`Library` },
  // The page's state is its URL: ?q=…&shape=…&filter=failed. Unknown values are dropped.
  validateSearch: (search: Record<string, unknown>): LibrarySearch => parseLibrarySearch(search),
  component: Library,
});

function Library() {
  const { t } = useLingui();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: '/library/' });
  return (
    <Page title={t`Library`} width="wide" actions={<LibraryActions />} views={<LibraryViews />}>
      <ActiveImports />
      <ImportDrop>
        <LibraryPage
          search={search}
          // Typing and filtering replace the entry, so Back leaves the library instead of undoing each letter.
          onSearch={(next) => void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })}
        />
      </ImportDrop>
    </Page>
  );
}
