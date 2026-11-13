// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, Outlet } from '@tanstack/react-router';
import { parseUsageSearch, type UsageSearch } from '../../features/settings/usage/usage-search';

/**
 * Settings › Usage, by task (UX4): Overview, Breakdown, Budgets and Requests, each its own page under this one. The
 * period and the filters are validated here, once, so every view reads the same view of the URL and a link
 * (Privacy's "See in Usage", ?module=…, a rate-limit card, a bookmark) keeps working on any of them.
 */
export const Route = createFileRoute('/settings/usage')({
  // ?period=7d&module=vision&provider=google&project=…: a linked view (Privacy's "See in Usage" sends ?module=).
  validateSearch: (search: Record<string, unknown>): UsageSearch => parseUsageSearch(search),
  component: Outlet,
});
