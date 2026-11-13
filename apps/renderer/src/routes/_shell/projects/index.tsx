// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { ProjectsPage } from '../../../features/make/projects-page';

interface ProjectsSearch {
  /** The archived projects instead of the current ones. */
  archived?: true | undefined;
}

/**
 * The Make area's home (P2-X3), titled Make like the area (UX1): every project, newest change first;
 * `?archived=true` lists the archived ones, with "Archived" after the title. The page frames itself (UX4), so its
 * views and its action sit in Page's slots.
 */
export const Route = createFileRoute('/_shell/projects/')({
  // A crumb: the editor and Exports show "Make ›", the area's name in the sidebar (shell/nav).
  staticData: { crumb: msg`Make` },
  validateSearch: (search: Record<string, unknown>): ProjectsSearch => ({
    archived: search.archived === true || search.archived === 'true' ? true : undefined,
  }),
  component: Projects,
});

function Projects() {
  const { archived } = Route.useSearch();
  return <ProjectsPage archived={archived === true} />;
}
