// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { StylePage } from '../../../features/make/style-page';

/**
 * Your style (UX4): what the templates behind your finished exports have in common (LRN1-STY's "my exports"
 * profile), one of Make's views. It sat above the export queue until UX4 gave it a page of its own: the window bar
 * reads "Make › Your style", and the page's views lead back to the projects.
 */
export const Route = createFileRoute('/_shell/projects/style')({
  staticData: { up: '/projects' },
  component: StylePage,
});
