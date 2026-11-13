// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * startMcpMain (mcp-main.ts) with Electron's parts, so composeMain takes one line: the clipboard the setup text is
 * copied to, the running app's own `taalcut` shim, and system notifications for an external agent's approvals.
 */
import type { I18n } from '@lingui/core';
import type { Container, EventBus } from '@taalcut/core';
import type { SecretStore } from '@taalcut/models';
import { app, clipboard } from 'electron';
import type { UtilityHost } from '../rpc/utility-host';
import { electronMcpNotifier } from './approval-notify-electron';
import { mcpShimPath, startMcpMain } from './mcp-main';

export interface DesktopMcpDeps {
  readonly host: Pick<UtilityHost, 'client'>;
  readonly vault: SecretStore;
  readonly events: Pick<EventBus, 'emit'>;
  readonly options: { readonly runtime: { readonly packaged: boolean }; readonly resourcesPath: string };
  /** Main's words in the app's language (AppLanguage.i18n), for the approval notification. */
  readonly i18n: Pick<I18n, '_'>;
}

export function startDesktopMcp(
  container: Container,
  { host, vault, events, options, i18n }: DesktopMcpDeps,
) {
  const packaged = options.runtime.packaged;
  return startMcpMain(container, {
    host,
    vault,
    shimPath: mcpShimPath({ packaged, resourcesPath: options.resourcesPath, appPath: app.getAppPath() }),
    clipboard,
    notifier: electronMcpNotifier(i18n, events),
  });
}
