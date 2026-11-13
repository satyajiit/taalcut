// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { ModelsDownloads } from '../../../features/settings/models/models-downloads';

/** Settings › Models › Downloads (UX4): what this Mac downloads to run the jobs, with its controls. */
export const Route = createFileRoute('/settings/models/downloads')({
  component: ModelsDownloads,
});
