// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { UsageOverview } from '../../../features/settings/usage/usage-overview';
import { searchOf, viewOf } from '../../../features/settings/usage/usage-search';

export const Route = createFileRoute('/settings/usage/')({
  // The views read "Usage › Breakdown": the shell's crumbs find the route that is exactly /settings/usage, this one.
  staticData: { crumb: msg`Usage` },
  // The old one-page Usage linked its budgets as #budgets; they are a view of their own now.
  beforeLoad: ({ location }) => {
    if (location.hash === 'budgets') throw redirect({ to: '/settings/usage/budgets', replace: true });
  },
  component: Overview,
});

function Overview() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <UsageOverview
      view={viewOf(search)}
      onViewChange={(next) => void navigate({ search: searchOf(next), replace: true, resetScroll: false })}
    />
  );
}
