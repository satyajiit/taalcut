// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { UpdatesSettings } from '../../features/updates/updates-settings';

/** Settings › General › Updates (UX4): out of About, its own page under General's row. */
export const Route = createFileRoute('/settings/updates')({
  staticData: { up: '/settings/general' },
  component: UpdatesSettings,
});
