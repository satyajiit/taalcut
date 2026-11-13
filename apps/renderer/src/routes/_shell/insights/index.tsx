// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { msg } from '@lingui/core/macro';
import { createFileRoute } from '@tanstack/react-router';
import { InsightsPage } from '../../../features/insights/insights-page';

/**
 * The Insights area: trending Instagram Edits audio (with cover art thumbnails, live audio preview,
 * and both royalty-free and IG-licensed/original music), Trending Reel Blueprints, and inline plugin
 * activation & connection controls.
 */
export const Route = createFileRoute('/_shell/insights/')({
  staticData: { crumb: msg`Insights` },
  component: InsightsPage,
});
