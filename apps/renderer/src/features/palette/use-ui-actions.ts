// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  DOWNLOADS_SHOW_ACTION,
  HUB_COMMANDS,
  SETTINGS_COMMANDS,
  type SystemSettingsPane,
  type UiAction,
  type UiCommandName,
} from '@taalcut/core';
import type { PaletteItem } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { useBackend } from '../../backend/backend';
import { useBackendEvents } from '../../backend/use-events';
import { searchId } from '../../shell/route-id';
import { downloadsAnchor, jobArg } from '../downloads/downloads-anchor';
import { openHubShare } from '../templates/hub/share-requests';
import { prepareNarrationNavigation } from '../timeline/narration-preparation';

/**
 * Fix buttons that open a pane of System Settings: Privacy & Security › Files and Folders when macOS won't let
 * Taalcut read a folder (library.folder_permission_denied), General › Storage when the models don't fit on the
 * disk (UX2-DOWNLOADER). Main opens only its fixed URL for the pane.
 */
const SETTINGS_PANES = new Map<string, SystemSettingsPane>([
  ['system.openFilesAndFolders' satisfies UiCommandName, 'filesAndFolders'],
  ['system.openStorage' satisfies UiCommandName, 'storage'],
]);

/**
 * Runs the `ui.action` events main sends this window: core's UI commands
 * (go.*, edit.*) from the app menu, the agent or MCP, and bus commands that
 * need the page, such as settings.openSignInWarning. An action is a palette
 * item's id, so the menu, ⌘K and the shortcut do one thing; the few that take
 * arguments are handled here. Unknown actions are ignored (an older page, a
 * newer main), and so is the deprecated reference.showWarning: the reel-download card it opened is gone (REF1).
 */
export function useUiActions(items: readonly PaletteItem[]): void {
  const navigate = useNavigate();
  const backend = useBackend();
  const latest = useRef(items);
  useEffect(() => {
    latest.current = items;
  }, [items]);

  useBackendEvents(['ui.action'], ({ payload }) => run(payload));

  function run({ action, args }: UiAction) {
    if (action === 'products.open') {
      const productId = searchId<'Product'>(args?.productId);
      if (productId) void navigate({ to: '/products/$productId', params: { productId } });
      return;
    }
    if (action === 'timeline.prepareNarration') {
      prepareNarrationNavigation(navigate, args);
      return;
    }
    if (action === SETTINGS_COMMANDS.openSignInWarning) {
      void navigate({ to: '/settings/accounts', search: { warning: args?.feature } });
      return;
    }
    // The fixes "Open Accounts" and "Open Models" on models' errors: a model not set up or signed out, a download.
    if (action === SETTINGS_COMMANDS.openAccounts) {
      void navigate({ to: '/settings/accounts' });
      return;
    }
    if (action === SETTINGS_COMMANDS.openModels) {
      void navigate({ to: '/settings/models' });
      return;
    }
    // P3-B12: the agent's hub.openShare opens that template's Share dialog (the person still presses Share).
    if (action === HUB_COMMANDS.openShare) {
      const templateId = searchId<'Template'>(args?.templateId);
      const version = Number(args?.version);
      if (templateId)
        openHubShare(navigate, templateId, Number.isInteger(version) && version > 0 ? version : undefined);
      return;
    }
    // UX2-DOWNLOADER: main's "couldn't download" notification, clicked: Settings › Models on that job's row.
    if (action === DOWNLOADS_SHOW_ACTION) {
      void navigate({ to: '/settings/models', hash: downloadsAnchor(jobArg(args?.job)) });
      return;
    }
    const pane = SETTINGS_PANES.get(action);
    if (pane) {
      void callRpc(backend.files.openSystemSettings({ pane })).then((opened) => {
        if (!opened.ok) console.warn(`[ui] System Settings (${pane}) didn’t open: ${opened.error.code}`);
      });
      return;
    }
    const item = latest.current.find((candidate) => candidate.id === action);
    if (item && !item.disabled) void item.run();
  }
}
