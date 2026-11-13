// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * "Notify me" (P2-M11): when a render the user asked to hear about reaches
 * a final state (`render.finished` with `notify`), main posts a system
 * notification; clicking it brings the app forward. A cancelled render is
 * the user's own doing, so it stays quiet. Electron is injected
 * (render-notify-electron.ts wires it), so this is unit-tested.
 */
import type { I18n } from '@lingui/core';
import type { EventBus } from '@taalcut/core';
import { RENDER_NOTIFY_MESSAGES } from '../i18n/render-messages';

/** The part of Electron's Notification used here. */
export interface NotificationLike {
  show(): void;
  on(event: 'click' | 'close', listener: () => void): unknown;
}

export interface RenderNotifyDeps {
  readonly events: Pick<EventBus, 'on'>;
  readonly i18n: Pick<I18n, '_'>;
  /** Notification.isSupported(). */
  readonly isSupported: () => boolean;
  /** new Notification({ title, body, silent: false }). */
  readonly create: (options: { readonly title: string; readonly body: string }) => NotificationLike;
  /** Shows and focuses the main window. */
  readonly focus: () => void;
}

/** Starts listening; returns the unsubscribe. */
export function startRenderNotifications(deps: RenderNotifyDeps): () => void {
  // Electron drops a notification's click handler if the object is collected, so keep each until it closes.
  const live = new Set<NotificationLike>();
  return deps.events.on('render.finished', ({ payload }) => {
    if (!payload.notify || payload.status === 'cancelled' || !deps.isSupported()) return;
    const messages = RENDER_NOTIFY_MESSAGES[payload.status];
    const notification = deps.create({
      title: deps.i18n._(messages.title),
      body: deps.i18n._({ ...messages.body, values: { name: payload.name } }),
    });
    live.add(notification);
    notification.on('click', () => {
      live.delete(notification);
      deps.focus();
    });
    notification.on('close', () => live.delete(notification));
    notification.show();
  });
}
