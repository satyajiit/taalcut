// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Electron's side of the external agents' approval notification: the system Notification, in the app's language
 * (AppLanguage.i18n), windows.
 */
import type { I18n } from '@lingui/core';
import type { EventBus } from '@taalcut/core';
import { BrowserWindow, Notification } from 'electron';
import type { McpNotifier } from './approval-notify';

export function electronMcpNotifier(i18n: Pick<I18n, '_'>, events: Pick<EventBus, 'emit'>): McpNotifier {
  return {
    i18n,
    isSupported: () => Notification.isSupported(),
    create: (options) => new Notification({ ...options, silent: false }),
    windowFocused: () => BrowserWindow.getFocusedWindow() !== null,
    open: () => {
      const [win] = BrowserWindow.getAllWindows();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
      // The approval card is in the session's conversation, in the agent area.
      events.emit('ui.action', { action: 'go.agent' });
    },
  };
}
