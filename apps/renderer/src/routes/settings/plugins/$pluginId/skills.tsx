// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createFileRoute } from '@tanstack/react-router';
import { PluginSkillsView } from '../../../../features/settings/plugins/plugin-view-pages';

/** A plugin › Skills: The guides the plugin brings for the AI. */
export const Route = createFileRoute('/settings/plugins/$pluginId/skills')({
  component: PluginSkillsView,
});
