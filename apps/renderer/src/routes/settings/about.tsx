// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, redirect } from '@tanstack/react-router';
import { AboutSettings } from '../../features/settings/about/about-settings';
import { LANGUAGE_ANCHOR } from '../../features/settings/language/language-section';

/**
 * Settings › General › About (UX4): the version, the licences and the links. Its old address still lands: a link
 * that names the language list on About (⌘K's "Change language…" until it points at General) goes to General.
 */
export const Route = createFileRoute('/settings/about')({
  staticData: { up: '/settings/general' },
  beforeLoad: ({ location }) => {
    if (location.hash === LANGUAGE_ANCHOR)
      throw redirect({ to: '/settings/general', hash: LANGUAGE_ANCHOR, replace: true });
  },
  component: AboutSettings,
});
