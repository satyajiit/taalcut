// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { INSTAGRAM_WARNING } from '@taalcut/core';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { AccountsSettings } from '../../../features/settings/accounts/accounts-settings';

/** Accounts › Connected, the first view: what Taalcut can use right now. */
export const Route = createFileRoute('/settings/accounts/')({
  staticData: { crumb: msg`Accounts` },
  // A warning asked for by its feature (⌘K's "Review the warning", palette's settings.openSignInWarning) lands
  // where its card is: Subscriptions for the plans, Templates › Saved for Instagram, whose sign-in lives there.
  beforeLoad: ({ search }) => {
    if (!search.warning) return;
    if (search.warning === INSTAGRAM_WARNING.feature)
      throw redirect({ to: '/templates/saved', search: { warning: search.warning }, replace: true });
    throw redirect({
      to: '/settings/accounts/subscriptions',
      search: { warning: search.warning },
      replace: true,
    });
  },
  component: AccountsSettings,
});
