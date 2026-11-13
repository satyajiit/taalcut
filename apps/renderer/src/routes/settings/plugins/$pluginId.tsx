// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { pluginIdSchema } from '@taalcut/core';
import { createFileRoute, notFound, useLocation } from '@tanstack/react-router';
import { PluginDetailsLayout } from '../../../features/settings/plugins/plugin-details-page';
import { pluginViewOf } from '../../../features/settings/plugins/plugin-views';

/** A plugin (UX4): its header and views; each view is a child route (connection, access, tools, skills). */
export const Route = createFileRoute('/settings/plugins/$pluginId')({
  params: {
    parse: ({ pluginId }) => {
      const parsed = pluginIdSchema.safeParse(pluginId);
      if (!parsed.success) throw notFound();
      return { pluginId: parsed.data };
    },
  },
  component: PluginDetails,
});

function PluginDetails() {
  const { pluginId } = Route.useParams();
  const view = pluginViewOf(useLocation({ select: (location) => location.pathname }));
  // Keyed by the plugin, so another plugin's state never carries over.
  return <PluginDetailsLayout key={pluginId} pluginId={pluginId} view={view} />;
}
