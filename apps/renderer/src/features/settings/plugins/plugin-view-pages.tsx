// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A plugin's four views (UX4), each a child route of the plugin's layout (plugin-details-page.tsx), which reads the
 * registry once and hands the open plugin and its actions down.
 */
import { PluginAccess } from './plugin-access';
import { PluginCapabilities, PluginSkills, PluginTools } from './plugin-capabilities';
import { PluginConnection } from './plugin-connection';
import { usePluginPage } from './plugin-details-page';

/** Connection: where it connects, its credentials and the test. */
export function PluginConnectionView() {
  const { plugin, actions } = usePluginPage();
  // A saved address resets the form to what was saved.
  return <PluginConnection key={JSON.stringify(plugin.config)} plugin={plugin} actions={actions} />;
}

/** Access: what the AI may do with it, and the switch that lets it. */
export function PluginAccessView() {
  const { plugin, actions } = usePluginPage();
  return <PluginAccess plugin={plugin} actions={actions} />;
}

/** Tools: what it can do (its features), and the tools the AI can find with the access given. */
export function PluginToolsView() {
  const { plugin } = usePluginPage();
  return (
    <>
      <PluginCapabilities plugin={plugin} />
      <PluginTools plugin={plugin} />
    </>
  );
}

/** Skills: the guides it brings, readable before it is turned on. */
export function PluginSkillsView() {
  const { plugin } = usePluginPage();
  return <PluginSkills plugin={plugin} />;
}
