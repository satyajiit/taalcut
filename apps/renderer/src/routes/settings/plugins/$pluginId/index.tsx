// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, redirect } from '@tanstack/react-router';

/** A plugin opens on its Connection view: every link to /settings/plugins/<id> lands there, and Back skips it. */
export const Route = createFileRoute('/settings/plugins/$pluginId/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/settings/plugins/$pluginId/connection', params, replace: true });
  },
});
