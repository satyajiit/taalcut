// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · view: a plugin › Access (UX4) · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.6 + UX4 (_orch/ux4/specs/design-set.md "One row")
 * what the AI may do with the plugin: one row per kind of access, each the kit's Checkbox with its words (the whole
 *   row is the hit area), then the switch that lets the AI use it at all, then Disconnect (asked first, in a dialog)
 * states: default · hover (the row washes) · focus (the box's ring) · checked (the drawn tick) · disabled (while a
 *   change runs, or before the credentials are in, said why) · loading (the switch's spinner) · error (the layout's
 *   line) · disconnecting (the dialog's button spins) */
import { Trans, useLingui } from '@lingui/react/macro';
import { PLUGIN_COMMANDS, type PluginView } from '@taalcut/core';
import {
  Button,
  Checkbox,
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  HOVER_EASE,
  PageSection,
  VERB_ICONS,
  cn,
} from '@taalcut/ui';
import { useState } from 'react';
import { SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { SwitchRow } from '../switch-row';
import { pluginText } from './plugin-text';
import type { PluginActions } from './use-plugins';

export function PluginAccess({ plugin, actions }: { plugin: PluginView; actions: PluginActions }) {
  const { t, i18n } = useLingui();
  const [disconnecting, setDisconnecting] = useState(false);
  const complete = plugin.manifest.credentials.every(
    (field) => !field.required || plugin.configuredCredentials.includes(field.id),
  );
  const busy = actions.pending !== null;
  const pluginId = plugin.manifest.id;
  return (
    <PageSection
      icon={SETTINGS_ICONS.access}
      title={<Trans>Access for the AI</Trans>}
      description={
        <Trans>
          Choose what this plugin may do. Changes apply immediately. Turning it off keeps the saved connection
          for later.
        </Trans>
      }
    >
      <SettingRows aria-label={t`What the AI may do`}>
        {plugin.manifest.access.map((access) => (
          <li
            key={access.id}
            data-slot="plugin-access-row"
            className="border-t border-rule-subtle first:border-t-0"
          >
            <Checkbox
              label={pluginText(i18n, access.name)}
              description={<span className="block max-w-prose">{pluginText(i18n, access.description)}</span>}
              checked={plugin.grantedAccess.includes(access.id)}
              disabled={busy}
              className={cn('flex min-h-12 w-full px-3 py-2.5', HOVER_EASE, !busy && 'hover:bg-hover')}
              onCheckedChange={(checked) =>
                void actions.dispatch('access', PLUGIN_COMMANDS.setAccess, {
                  pluginId,
                  access: checked
                    ? [...plugin.grantedAccess, access.id]
                    : plugin.grantedAccess.filter((id) => id !== access.id),
                })
              }
            />
          </li>
        ))}
      </SettingRows>
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
          void actions.dispatch('enabled', PLUGIN_COMMANDS.setEnabled, { pluginId, enabled })
        }
      />
      {plugin.configuredCredentials.length > 0 ? (
        <div>
          <Button
            variant="ghost"
            icon={VERB_ICONS.forget}
            disabled={busy}
            onClick={() => setDisconnecting(true)}
          >
            <Trans>Disconnect plugin</Trans>
          </Button>
        </div>
      ) : null}
      <Dialog open={disconnecting} onOpenChange={setDisconnecting}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <Trans>Disconnect this plugin?</Trans>
            </DialogTitle>
            <DialogDescription>
              <Trans>
                This turns off the plugin and removes its saved credentials. You can connect it again later.
              </Trans>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button disabled={busy}>
                <Trans>Cancel</Trans>
              </Button>
            </DialogClose>
            <Button
              variant="destructive"
              loading={actions.pending === 'disconnect'}
              disabled={busy}
              onClick={async () => {
                if (await actions.dispatch('disconnect', PLUGIN_COMMANDS.disconnect, { pluginId }))
                  setDisconnecting(false);
              }}
            >
              <Trans>Disconnect plugin</Trans>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageSection>
  );
}
