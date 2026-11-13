// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · view: a plugin › Connection (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md)
 * two sections: where it connects (the address fields and Save connection address, saved through the command bus),
 *   then its credentials (one row each: what it is, how it is kept, Import or Replace from clipboard; then Test
 *   connection with the setup guide and when it was last checked)
 * states: default · editing (Save enabled; import and test held until it is saved, said why) · saving and importing
 *   (the button's spinner) · saved (the credential's chip) · error (the layout's line) · tested (its status and date) */
import { Trans, useLingui } from '@lingui/react/macro';
import { PLUGIN_COMMANDS, type PluginView } from '@taalcut/core';
import { Button, Chip, Input, PageSection, VERB_ICONS } from '@taalcut/ui';
import { ClipboardPaste } from 'lucide-react';
import { useId, useState, type FormEvent } from 'react';
import { useBackend } from '../../../backend/backend';
import { BrowserLink } from '../../../chat/external-link';
import { DateTime } from '../../shared/time';
import { Field } from '../fields';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { SwitchRow } from '../switch-row';
import { pluginText } from './plugin-text';
import type { PluginActions } from './use-plugins';

export function PluginConnection({ plugin, actions }: { plugin: PluginView; actions: PluginActions }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const prefix = useId();
  const [config, setConfig] = useState(() =>
    Object.fromEntries(
      plugin.manifest.configFields.map((field) => [field.id, plugin.config[field.id] ?? field.defaultValue]),
    ),
  );
  const dirty = plugin.manifest.configFields.some(
    (field) => config[field.id] !== (plugin.config[field.id] ?? field.defaultValue),
  );
  const busy = actions.pending !== null;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    void actions.dispatch('configure', PLUGIN_COMMANDS.configure, { pluginId: plugin.manifest.id, config });
  };
  const complete = plugin.manifest.credentials.every(
    (field) => !field.required || plugin.configuredCredentials.includes(field.id),
  );
  return (
    <>
      <PageSection
        icon={SETTINGS_ICONS.connection}
        title={<Trans>Connection</Trans>}
        description={
          <Trans>
            Use the hosted service or your own instance, including an address on your Tailscale network.
          </Trans>
        }
      >
        {plugin.configuredCredentials.length > 0 ? (
          <p className="m-0 max-w-prose type-body text-ink-2">
            <Trans>
              Changing the connection address removes its saved credentials and turns off the plugin. Import
              the key for the new instance afterward.
            </Trans>
          </p>
        ) : null}
        <form onSubmit={submit} className="flex max-w-xl flex-col gap-4">
          {plugin.manifest.configFields.map((field) => (
            <Field
              key={field.id}
              htmlFor={`${prefix}-${field.id}`}
              label={pluginText(i18n, field.name)}
              hint={pluginText(i18n, field.description)}
            >
              <Input
                id={`${prefix}-${field.id}`}
                type={field.kind === 'url' ? 'url' : 'text'}
                value={config[field.id] ?? ''}
                required={field.required}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => setConfig({ ...config, [field.id]: event.target.value })}
              />
            </Field>
          ))}
          <div>
            <Button type="submit" disabled={busy || !dirty} loading={actions.pending === 'configure'}>
              <Trans>Save connection address</Trans>
            </Button>
          </div>
        </form>
      </PageSection>
      <PageSection
        icon={SETTINGS_ICONS.keys}
        title={<Trans>Credentials</Trans>}
        description={
          <Trans>
            Copy the credential, then import it. It is stored securely on this Mac and never shown to the AI.
          </Trans>
        }
      >
        <SettingRows aria-label={t`Credentials`}>
          {plugin.manifest.credentials.map((field) => {
            const saved = plugin.configuredCredentials.includes(field.id);
            return (
              <SettingRow
                key={field.id}
                icon={SETTINGS_ICONS.keys}
                title={pluginText(i18n, field.name)}
                description={pluginText(i18n, field.description)}
                status={
                  saved ? (
                    <Chip tone="success">
                      <Trans>Credential saved</Trans>
                    </Chip>
                  ) : null
                }
                control={
                  <Button
                    size="sm"
                    icon={ClipboardPaste}
                    disabled={busy || dirty}
                    loading={actions.pending === field.id}
                    onClick={() =>
                      void actions.run(field.id, () =>
                        backend.pluginsSetup.importCredential({
                          pluginId: plugin.manifest.id,
                          credentialId: field.id,
                        }),
                      )
                    }
                  >
                    {saved ? <Trans>Replace from clipboard</Trans> : <Trans>Import from clipboard</Trans>}
                  </Button>
                }
              />
            );
          })}
        </SettingRows>
        {dirty ? (
          <p role="status" className="m-0 type-body text-ink-2">
            <Trans>Save the connection address before importing a credential or testing.</Trans>
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Button
            icon={VERB_ICONS.checkAgain}
            disabled={busy || dirty || !complete}
            loading={actions.pending === 'test'}
            onClick={() =>
              void actions.run('test', () =>
                backend.pluginsSetup.testConnection({ pluginId: plugin.manifest.id }),
              )
            }
          >
            <Trans>Test connection</Trans>
          </Button>
          <BrowserLink href={plugin.manifest.docs}>
            <Trans>Setup guide</Trans>
          </BrowserLink>
          {plugin.lastCheckedAt !== null && !plugin.error && !actions.error ? (
            <Chip tone="success">
              <Trans>Connection verified</Trans>
            </Chip>
          ) : null}
          {plugin.error || actions.error ? (
            <Chip tone="danger">
              <Trans>Connection failed</Trans>
            </Chip>
          ) : null}
          {plugin.lastCheckedAt !== null ? (
            <span className="type-meta text-ink-3">
              <Trans>
                Last checked <DateTime at={plugin.lastCheckedAt} />
              </Trans>
            </span>
          ) : null}
        </div>
        <SwitchRow
          label={<Trans>Let the AI use this plugin</Trans>}
          description={
            complete ? (
              <Trans>Its tools and skills become available within the access you selected.</Trans>
            ) : (
              <Trans>Import the required credentials before activating this plugin.</Trans>
            )
          }
          checked={plugin.enabled}
          disabled={busy || !complete}
          busy={actions.pending === 'enabled'}
          onChange={(enabled) =>
            void actions.dispatch('enabled', PLUGIN_COMMANDS.setEnabled, {
              pluginId: plugin.manifest.id,
              enabled,
            })
          }
        />
        <span className="sr-only">{t`Credentials are write-only.`}</span>
      </PageSection>
    </>
  );
}
