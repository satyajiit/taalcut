// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { KeysSettings } from '../../../features/settings/accounts/accounts-manage';

/** Accounts › Keys. `?add=<provider>` opens that provider's key form (a plan's "Use an API key instead"). */
export const Route = createFileRoute('/settings/accounts/keys')({
  validateSearch: (search: Record<string, unknown>): { add?: string | undefined } => ({
    add:
      typeof search.add === 'string' && /^[a-z0-9][a-z0-9._-]{0,99}$/.test(search.add)
        ? search.add
        : undefined,
  }),
  component: Keys,
});

function Keys() {
  const { add } = Route.useSearch();
  const navigate = Route.useNavigate();
  return (
    <KeysSettings
      add={add ?? null}
      onAddChange={(provider) =>
        void navigate({
          search: (prev) => ({ ...prev, add: provider ?? undefined }),
          replace: true,
          resetScroll: false,
        })
      }
    />
  );
}
