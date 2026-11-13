// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { GeneralSettings } from '../../features/settings/general/general-settings';

/** Settings › General (UX4): language, appearance, sounds, Kaatu and tips. Settings opens here. */
export const Route = createFileRoute('/settings/general')({
  // Updates, This Mac and About name General as the page above them (their `up`), so they read "General › About".
  staticData: { crumb: msg`General` },
  component: GeneralSettings,
});
