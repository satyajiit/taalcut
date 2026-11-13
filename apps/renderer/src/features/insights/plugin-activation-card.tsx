// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · component: PluginActivationCard · mode: Setup/Operate · system: DESIGN.md v0.7
 * Inline plugin activation & connection status plate inside Insights. Lets the creator enable a
 * disabled plugin, import its bearer token from the clipboard, verify the live MCP/API connection,
 * or jump to full plugin settings without leaving Insights.
 * states: active (compact status strip) · disabled (Enable CTA) · missing_credentials (Import token CTA) · degraded (Test connection CTA)
 * contrast: raised studio plate with rule hairline; semantic status chips
 * reduced-motion: instant state updates
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { PLUGIN_COMMANDS, type PluginView } from '@taalcut/core';
import { Button, Chip, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { ClipboardPaste } from 'lucide-react';
import { useBackend } from '../../backend/backend';
import { describeError } from '../settings/model-messages';
import { PluginLogo, PluginStatus } from '../settings/plugins/plugin-status';
import { pluginText } from '../settings/plugins/plugin-text';
import type { PluginActions } from '../settings/plugins/use-plugins';

export function PluginActivationCard({
  plugin,
  actions,
  onSyncComplete,
}: {
  plugin: PluginView;
  actions: PluginActions;
  onSyncComplete?: () => void;
}) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const pluginId = plugin.manifest.id;
  const busy = actions.pending !== null;
  const primaryCredential = plugin.manifest.credentials[0];
  const hasCredentials = plugin.manifest.credentials.every(
    (field) => !field.required || plugin.configuredCredentials.includes(field.id),
  );

  if (plugin.enabled && plugin.status === 'active') {
    return (
      <div
        data-slot="plugin-activation-card"
        data-plugin-id={pluginId}
        data-state="active"
        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-rule bg-raised px-4 py-3 shadow-xs"
      >
        <div className="flex min-w-0 items-center gap-3">
          <PluginLogo logo={plugin.manifest.logo} />
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span translate="no" className="type-card-title text-ink">
              {plugin.manifest.name}
            </span>
            <PluginStatus plugin={plugin} />
            <Chip tone="you">{t`Enabled`}</Chip>
          </div>
        </div>
        {actions.error ? (
          <p role="alert" className="m-0 type-caption text-danger-strong">
            {describeError(i18n, actions.error)}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            icon={VERB_ICONS.checkAgain}
            disabled={busy}
            loading={actions.pending === `test-${pluginId}`}
            onClick={async () => {
              await actions.run(`test-${pluginId}`, () => backend.pluginsSetup.testConnection({ pluginId }));
              onSyncComplete?.();
            }}
          >
            <Trans>Test connection</Trans>
          </Button>
          <Button asChild size="sm" variant="ghost" icon={VERB_ICONS.settings}>
            <Link to="/settings/plugins/$pluginId/connection" params={{ pluginId }}>
              <Trans>Connection settings</Trans>
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      data-slot="plugin-activation-card"
      data-plugin-id={pluginId}
      data-state={plugin.enabled ? plugin.status : 'disabled'}
      className="flex flex-col gap-3.5 rounded-xl border border-rule bg-raised p-4 shadow-xs"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3.5">
          <PluginLogo logo={plugin.manifest.logo} />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <span translate="no" className="type-card-title text-ink">
                {plugin.manifest.name}
              </span>
              <PluginStatus plugin={plugin} />
              {!plugin.enabled ? <Chip tone="neutral">{t`Disabled`}</Chip> : null}
            </div>
            <p className="m-0 max-w-prose type-body text-ink-2">
              {!plugin.enabled ? (
                <Trans>Enable this plugin to use its connected account in Insights.</Trans>
              ) : !hasCredentials ? (
                <Trans>
                  Copy the bearer token or API key for this plugin, then import it from your clipboard to
                  connect your account.
                </Trans>
              ) : (
                pluginText(i18n, plugin.manifest.description)
              )}
            </p>
            {plugin.error || actions.error ? (
              <p role="alert" className="m-0 type-caption text-danger-strong">
                {describeError(i18n, (actions.error ?? plugin.error)!)}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!plugin.enabled ? (
            <Button
              size="sm"
              icon={VERB_ICONS.approve}
              disabled={busy}
              loading={actions.pending === `enable-${pluginId}`}
              onClick={async () => {
                await actions.dispatch(`enable-${pluginId}`, PLUGIN_COMMANDS.setEnabled, {
                  pluginId,
                  enabled: true,
                });
                onSyncComplete?.();
              }}
            >
              <Trans>Enable plugin</Trans>
            </Button>
          ) : null}

          {primaryCredential ? (
            <Button
              size="sm"
              icon={ClipboardPaste}
              disabled={busy}
              loading={actions.pending === `cred-${pluginId}`}
              onClick={async () => {
                const imported = await actions.run(`cred-${pluginId}`, () =>
                  backend.pluginsSetup.importCredential({
                    pluginId,
                    credentialId: primaryCredential.id,
                  }),
                );
                if (!imported) return;
                if (!plugin.enabled) {
                  const enabled = await actions.dispatch(`enable-${pluginId}`, PLUGIN_COMMANDS.setEnabled, {
                    pluginId,
                    enabled: true,
                  });
                  if (!enabled) return;
                }
                onSyncComplete?.();
              }}
            >
              {hasCredentials ? (
                <Trans>Replace token from clipboard</Trans>
              ) : (
                <Trans>Import token from clipboard</Trans>
              )}
            </Button>
          ) : null}

          {hasCredentials ? (
            <Button
              size="sm"
              variant="ghost"
              icon={VERB_ICONS.checkAgain}
              disabled={busy}
              loading={actions.pending === `test-${pluginId}`}
              onClick={async () => {
                await actions.run(`test-${pluginId}`, () =>
                  backend.pluginsSetup.testConnection({ pluginId }),
                );
                onSyncComplete?.();
              }}
            >
              <Trans>Test connection</Trans>
            </Button>
          ) : null}

          <Button asChild size="sm" variant="ghost" icon={VERB_ICONS.settings}>
            <Link to="/settings/plugins/$pluginId/connection" params={{ pluginId }}>
              <Trans>Configure plugin</Trans>
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
