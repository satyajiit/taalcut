// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: a plugin's views (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (the kit's ViewLinks through SettingsViews)
 * Connection, Access, Tools and Skills, each its own page under the plugin: where it connects and with which key,
 *   what the AI may do with it, what it can do, and the guides it brings. Each is led by its glyph.
 * states: the kit's ViewLink: default · hover · focus-visible · active · current */
import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsViews } from '../settings-page';

export const PLUGIN_VIEWS = ['connection', 'access', 'tools', 'skills'] as const;
export type PluginViewId = (typeof PLUGIN_VIEWS)[number];

/** The view a plugin's URL is on ('/settings/plugins/postiz/access' → 'access'); Connection otherwise. */
export function pluginViewOf(pathname: string): PluginViewId {
  const last = pathname.replace(/\/+$/, '').split('/').at(-1);
  return PLUGIN_VIEWS.find((view) => view === last) ?? 'connection';
}

export function PluginViews({ pluginId, current }: { pluginId: string; current: PluginViewId }) {
  const { t } = useLingui();
  const params = { pluginId };
  return (
    <SettingsViews
      // The app's word, not the plugin's name: the name is the page's title, and a landmark's name is translated.
      label={t`Plugin`}
      current={current}
      views={[
        {
          id: 'connection',
          label: t`Connection`,
          icon: SETTINGS_ICONS.connection,
          link: <Link to="/settings/plugins/$pluginId/connection" params={params}>{t`Connection`}</Link>,
        },
        {
          id: 'access',
          label: t`Access`,
          icon: SETTINGS_ICONS.access,
          link: <Link to="/settings/plugins/$pluginId/access" params={params}>{t`Access`}</Link>,
        },
        {
          id: 'tools',
          label: t`Tools`,
          icon: SETTINGS_ICONS.tools,
          link: <Link to="/settings/plugins/$pluginId/tools" params={params}>{t`Tools`}</Link>,
        },
        {
          id: 'skills',
          label: t`Skills`,
          icon: SETTINGS_ICONS.skills,
          link: <Link to="/settings/plugins/$pluginId/skills" params={params}>{t`Skills`}</Link>,
        },
      ]}
    />
  );
}
