// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { UsageBreakdown } from '../../../features/settings/usage/usage-breakdown';
import { searchOf, viewOf } from '../../../features/settings/usage/usage-search';

/** Settings › Usage › Breakdown: where the period's spend went, by job, provider and project. */
export const Route = createFileRoute('/settings/usage/breakdown')({
  component: Breakdown,
});

function Breakdown() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <UsageBreakdown
      view={viewOf(search)}
      onViewChange={(next) => void navigate({ search: searchOf(next), replace: true, resetScroll: false })}
    />
  );
}
