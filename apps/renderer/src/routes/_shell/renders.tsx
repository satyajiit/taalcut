// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { RendersPage } from '../../features/renders/renders-page';

/**
 * Exports (P2-M11): every export, live, newest first. A view of the Make area beside its projects (UX1): the
 * window bar reads "Make › Exports", and the page's views lead back to the projects. The page frames itself
 * (UX4), so its views sit in Page's views slot.
 */
export const Route = createFileRoute('/_shell/renders')({
  // Exports is one of Make's views: its way up is Make (/projects), though its path isn't under it (shell/nav).
  staticData: { up: '/projects' },
  component: Renders,
});

function Renders() {
  return <RendersPage />;
}
