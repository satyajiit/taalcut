// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { PluginAccessView } from '../../../../features/settings/plugins/plugin-view-pages';

/** A plugin › Access: What the AI may do with the plugin, and turning it on. */
export const Route = createFileRoute('/settings/plugins/$pluginId/access')({
  component: PluginAccessView,
});
