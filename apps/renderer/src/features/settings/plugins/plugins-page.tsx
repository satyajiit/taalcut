// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page: Settings › Plugins (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * every plugin this build has, as rows that are links (the whole row opens the plugin, with its chevron): its bundled
 *   logo, its name, what it does and who makes it, then its status (and Setup requested when the AI asked)
 * states: loading (the named skeleton) · error (the cause, Try again) · none (Kaatu and one sentence) · a plugin
 *   asked for by the AI (its chip, live) · hover/press (the row's) */
import { Trans, useLingui } from '@lingui/react/macro';
import { Chip, EmptyState, PageSection, Skeleton } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { LoadError } from '../fields';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { SettingsPage } from '../settings-page';
import { PluginLogo, PluginStatus } from './plugin-status';
import { pluginText } from './plugin-text';
import { PluginsBones } from './plugins-bones';
import { usePlugins } from './use-plugins';

export function PluginsPage() {
  const { t, i18n } = useLingui();
  const plugins = usePlugins();
  const list = plugins.data;
  return (
    <SettingsPage
      title={t`Plugins`}
      description={
        <Trans>
          Connect services so Taalcut can use their features and skills with the access you choose.
        </Trans>
      }
    >
      {plugins.error ? (
        <LoadError
          error={plugins.error}
          onRetry={plugins.reload}
          what={<Trans>Plugins didn’t load.</Trans>}
        />
      ) : null}
      <Skeleton name="settings-plugins" loading={plugins.status === 'loading'} fixture={<PluginsBones />}>
        {list?.length === 0 ? (
          <EmptyState
            icon={SETTINGS_ICONS.plugins}
            title={<Trans>No plugins in this build</Trans>}
            description={
              <Trans>
                Plugins connect Taalcut to services you use. When this build has one, it shows here.
              </Trans>
            }
          />
        ) : (
          <PageSection
            icon={SETTINGS_ICONS.plugins}
            title={<Trans>Available plugins</Trans>}
            description={
              <Trans>
                Each plugin has its own connection, permissions and skills. Open one to set it up.
              </Trans>
            }
          >
            <SettingRows aria-label={t`Available plugins`}>
              {list?.map((plugin) => (
                <SettingRow
                  key={plugin.manifest.id}
                  icon={<PluginLogo logo={plugin.manifest.logo} />}
                  title={<span translate="no">{plugin.manifest.name}</span>}
                  description={
                    <>
                      {pluginText(i18n, plugin.manifest.summary)}{' '}
                      <span translate="no" className="text-ink-3">
                        · {plugin.manifest.publisher}
                      </span>
                    </>
                  }
                  status={
                    <span className="flex flex-wrap items-center justify-end gap-2">
                      {plugin.setupRequested ? (
                        <Chip tone="ai">
                          <Trans>Setup requested</Trans>
                        </Chip>
                      ) : null}
                      <PluginStatus plugin={plugin} />
                    </span>
                  }
                  action={<Link to="/settings/plugins/$pluginId" params={{ pluginId: plugin.manifest.id }} />}
                />
              ))}
            </SettingRows>
          </PageSection>
        )}
      </Skeleton>
    </SettingsPage>
  );
}
