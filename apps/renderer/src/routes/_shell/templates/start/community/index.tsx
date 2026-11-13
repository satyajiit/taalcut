// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { HubPage } from '../../../../../features/templates/hub/hub-page';
import { parseHubSearch, type HubSearch } from '../../../../../features/templates/hub/hub-search';

/** Start from… › Community (UX4 tpl; the template hub, P3-B12): `?q=…&lang=…&format=…&max=…&tags=…&sort=…`. */
export const Route = createFileRoute('/_shell/templates/start/community/')({
  // A crumb: a community template shows "Templates › Start from… › Community ›" (shell/nav).
  staticData: { crumb: msg`Community` },
  validateSearch: (search: Record<string, unknown>): HubSearch => parseHubSearch(search),
  component: Community,
});

function Community() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <HubPage
      search={search}
      onSearch={(next) => void navigate({ search: parseHubSearch({ ...next }), replace: true })}
    />
  );
}
