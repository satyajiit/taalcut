// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page: a plugin (/settings/plugins/$pluginId, UX4) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * the layout of a plugin's four views: the bar's "Plugins › <name>", the views (Connection, Access, Tools, Skills,
 *   each its own page), then who the plugin is (its bundled logo, what it does, its status, publisher, version and
 *   website) and the open view under it. The registry is read once here and shared with the view through context, so
 *   moving between views never reloads it.
 * states: loading (the named skeleton) · not found (the message page, back to Plugins) · error (the cause, Try again)
 *   · setup requested by the AI (one line, its chip) · an action failed (the cause, assertive) · the view's own */
import { Trans, useLingui } from '@lingui/react/macro';
import type { PluginView } from '@taalcut/core';
import { Chip, Skeleton } from '@taalcut/ui';
import { Link, Outlet } from '@tanstack/react-router';
import { createContext, useContext } from 'react';
import { BrowserLink } from '../../../chat/external-link';
import { MESSAGE_LINK, PlainMessage } from '../../../shell/plain-message';
import { LoadError, Notice } from '../fields';
import { describeError } from '../model-messages';
import { SettingsPage } from '../settings-page';
import { PluginLogo, PluginStatus } from './plugin-status';
import { pluginText } from './plugin-text';
import { PluginViews, type PluginViewId } from './plugin-views';
import { PluginsBones } from './plugins-bones';
import { usePluginActions, usePlugins, type PluginActions } from './use-plugins';

interface PluginPage {
  readonly plugin: PluginView;
  readonly actions: PluginActions;
}

const PluginContext = createContext<PluginPage | null>(null);

/** The open plugin and its actions, for a view under the plugin's layout. */
export function usePluginPage(): PluginPage {
  const page = useContext(PluginContext);
  // A view only renders inside the layout, after the plugin has loaded: anything else is a bug.
  if (!page) throw new Error('usePluginPage outside the plugin layout');
  return page;
}

/** Who the plugin is: its logo, what it does, and the facts about it. */
function PluginHeader({ plugin }: { plugin: PluginView }) {
  const { i18n } = useLingui();
  const version = plugin.manifest.version;
  return (
    <div data-slot="plugin-header" className="flex items-start gap-5">
      <PluginLogo logo={plugin.manifest.logo} large />
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <p className="m-0 max-w-prose type-prose text-ink-2">
          {pluginText(i18n, plugin.manifest.description)}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <PluginStatus plugin={plugin} />
          <span translate="no" className="type-meta text-ink-3">
            {plugin.manifest.publisher}
          </span>
          <span className="type-meta text-ink-3">
            <Trans>Version {version}</Trans>
          </span>
          <BrowserLink href={plugin.manifest.homepage}>
            <Trans>Website</Trans>
          </BrowserLink>
        </div>
      </div>
    </div>
  );
}

/** The plugin's layout: header, views and notices, then the open view (`<Outlet />`). */
export function PluginDetailsLayout({ pluginId, view }: { pluginId: string; view: PluginViewId }) {
  const { t, i18n } = useLingui();
  const plugins = usePlugins();
  const actions = usePluginActions(plugins.reload);
  const plugin = plugins.data?.find((entry) => entry.manifest.id === pluginId);
  if (plugins.status === 'ready' && !plugin)
    return (
      <PlainMessage
        inShell
        name={t`Page not found`}
        title={<Trans>This page doesn't exist</Trans>}
        sentence={<Trans>The link may be old, or the item was deleted. Your chats and clips are safe.</Trans>}
        link={
          <Link to="/settings/plugins" className={MESSAGE_LINK}>
            <Trans>Plugins</Trans>
          </Link>
        }
      />
    );
  const name = plugin?.manifest.name;
  return (
    <SettingsPage
      title={t`Plugins`}
      detail={name ? <span translate="no">{name}</span> : t`Plugin`}
      {...(plugin ? { views: <PluginViews pluginId={pluginId} current={view} /> } : {})}
    >
      {plugins.error ? (
        <LoadError
          error={plugins.error}
          onRetry={plugins.reload}
          what={<Trans>This plugin didn’t load.</Trans>}
        />
      ) : null}
      <Skeleton
        name="settings-plugin-detail"
        loading={!plugin && plugins.status === 'loading'}
        fixture={<PluginsBones detail />}
      >
        {plugin ? <PluginHeader plugin={plugin} /> : null}
      </Skeleton>
      {plugin?.setupRequested ? (
        <Notice tone="info">
          <span>
            <Chip tone="ai">
              <Trans>Setup requested</Trans>
            </Chip>
          </span>
          <Trans>The AI asked to use this plugin. Connect it and choose its access to continue.</Trans>
        </Notice>
      ) : null}
      {actions.error ? (
        <Notice tone="danger" role="alert">
          {describeError(i18n, actions.error)}
        </Notice>
      ) : null}
      {plugin?.error && !actions.error ? (
        <Notice tone="danger" role="alert">
          {describeError(i18n, plugin.error)}
        </Notice>
      ) : null}
      {plugin ? (
        <PluginContext.Provider value={{ plugin, actions }}>
          <Outlet />
        </PluginContext.Provider>
      ) : null}
    </SettingsPage>
  );
}
