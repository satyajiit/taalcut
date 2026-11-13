// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute, Outlet } from '@tanstack/react-router';

/** Settings › Privacy (UX4): two views, What leaves (the index) and Sharing, each its own page. */
export const Route = createFileRoute('/settings/privacy')({
  component: Outlet,
});
