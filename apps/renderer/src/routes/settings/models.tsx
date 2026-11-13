// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, Outlet } from '@tanstack/react-router';

/** Settings › Models (UX4): two views, the profile (the index, with each job's model under Advanced) and Downloads. */
export const Route = createFileRoute('/settings/models')({
  component: Outlet,
});
