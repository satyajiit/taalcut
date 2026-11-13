// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Electron's side of "Notify me": the system Notification, in the app's language (AppLanguage.i18n), the main window. */
import type { I18n } from '@lingui/core';
import type { EventBus } from '@taalcut/core';
import { BrowserWindow, Notification } from 'electron';
import { startRenderNotifications } from './render-notify';

export function startDesktopRenderNotifications(events: EventBus, i18n: Pick<I18n, '_'>): () => void {
  return startRenderNotifications({
    events,
    i18n,
    isSupported: () => Notification.isSupported(),
    create: (options) => new Notification({ ...options, silent: false }),
    focus: () => {
      const [win] = BrowserWindow.getAllWindows();
      if (!win) return;
      if (win.isMinimized()) win.restore();
      win.show();
      win.focus();
    },
  });
}
