// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { PluginToolsView } from '../../../../features/settings/plugins/plugin-view-pages';

/** A plugin › Tools: What the plugin can do: its features and the tools the AI can find. */
export const Route = createFileRoute('/settings/plugins/$pluginId/tools')({
  component: PluginToolsView,
});
