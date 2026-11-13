// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { searchOf, viewOf } from '../../../features/settings/usage/usage-search';
import { UsageRequests } from '../../../features/settings/usage/usage-requests';

/** Settings › Usage › Requests: every request to a model, for the period and filters. */
export const Route = createFileRoute('/settings/usage/requests')({
  component: Requests,
});

function Requests() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <UsageRequests
      view={viewOf(search)}
      onViewChange={(next) => void navigate({ search: searchOf(next), replace: true, resetScroll: false })}
    />
  );
}
