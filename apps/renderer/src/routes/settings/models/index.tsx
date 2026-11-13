// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { downloadsTarget } from '../../../features/downloads/downloads-anchor';
import { ModelsSettings } from '../../../features/settings/models/models-settings';

export const Route = createFileRoute('/settings/models/')({
  // The crumb lives on the index, the route the shell's crumbs find at /settings/models ("Models › Downloads").
  staticData: { crumb: msg`Models` },
  // ?advanced=true opens the per-job choices (⌘K "Choose a model for each job" links here).
  // The router spreads the raw search under this result, so anything else is set to undefined, not left out.
  validateSearch: (search: Record<string, unknown>): { advanced?: true | undefined } => ({
    advanced: search.advanced === true || search.advanced === 'true' ? true : undefined,
  }),
  // Main's "couldn't download" notification (and ⌘K's action for it) names a download in the hash: it lives on the
  // Downloads view now.
  beforeLoad: ({ location }) => {
    if (downloadsTarget(location.hash) !== undefined)
      throw redirect({ to: '/settings/models/downloads', hash: location.hash, replace: true });
  },
  component: Models,
});

function Models() {
  const { advanced } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <ModelsSettings
      advanced={advanced === true}
      onAdvancedChange={(open) =>
        void navigate({ search: open ? { advanced: true } : {}, replace: true, resetScroll: false })
      }
    />
  );
}
