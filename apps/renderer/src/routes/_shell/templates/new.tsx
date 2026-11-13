// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { NewTemplatePage } from '../../../features/templates/new/new-template-page';

/** New template (UX4 tpl): from a reel's link, or from template files. */
export const Route = createFileRoute('/_shell/templates/new')({
  component: NewTemplatePage,
});
