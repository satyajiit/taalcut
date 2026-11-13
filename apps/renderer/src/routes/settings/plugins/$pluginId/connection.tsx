// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { PluginConnectionView } from '../../../../features/settings/plugins/plugin-view-pages';

/** A plugin › Connection: Where the plugin connects, and its key. */
export const Route = createFileRoute('/settings/plugins/$pluginId/connection')({
  component: PluginConnectionView,
});
