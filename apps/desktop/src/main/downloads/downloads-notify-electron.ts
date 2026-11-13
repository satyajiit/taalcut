// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Electron's side of the download notifications: the system Notification, the main window, and the `ui.action`
 * that opens Settings › Models on a job's row (core's DOWNLOADS_SHOW_ACTION).
 */
import type { I18n } from '@lingui/core';
import { DOWNLOADS_SHOW_ACTION, type EventBus } from '@taalcut/core';
import { BrowserWindow, Notification } from 'electron';
import { startDownloadsNotifications } from './downloads-notify';

function focusMainWindow(): void {
  const [win] = BrowserWindow.getAllWindows();
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function startDesktopDownloadsNotifications(
  events: Pick<EventBus, 'on' | 'emit'>,
  i18n: Pick<I18n, '_' | 'locale'>,
): () => void {
  return startDownloadsNotifications({
    events,
    i18n,
    isSupported: () => Notification.isSupported(),
    create: (options) => new Notification({ ...options, silent: false }),
    windowFocused: () => BrowserWindow.getFocusedWindow() !== null,
    focus: focusMainWindow,
    showDownloads: (job) => {
      focusMainWindow();
      events.emit('ui.action', { action: DOWNLOADS_SHOW_ACTION, ...(job ? { args: { job } } : {}) });
    },
  });
}
