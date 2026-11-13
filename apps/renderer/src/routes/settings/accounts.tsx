// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, Outlet } from '@tanstack/react-router';

/**
 * Settings › Accounts (UX4): four views, each its own page under this one (Connected, Keys, Subscriptions,
 * Servers). The crumb is on the index route, the route the shell's crumbs find at /settings/accounts.
 */
export const Route = createFileRoute('/settings/accounts')({
  // ?warning=<feature> opens that sign-in's warning card (settings.openSignInWarning, the fix on
  // models.acknowledgement_required); the index sends it on to Subscriptions, where the card is. Anything else is
  // set to undefined, not left out.
  validateSearch: (search: Record<string, unknown>): { warning?: string | undefined } => ({
    warning: typeof search.warning === 'string' && search.warning.length <= 100 ? search.warning : undefined,
  }),
  component: Outlet,
});
