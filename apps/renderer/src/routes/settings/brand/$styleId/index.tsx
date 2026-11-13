// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, redirect } from '@tanstack/react-router';

/** A brand kit opens on its Colours: every link to /settings/brand/<id> lands there, and Back skips it. */
export const Route = createFileRoute('/settings/brand/$styleId/')({
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/settings/brand/$styleId/colours', params, replace: true });
  },
});
