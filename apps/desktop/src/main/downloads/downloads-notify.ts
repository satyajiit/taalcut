// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * UX2-DOWNLOADER: main's notifications about the download of everything this Mac needs (the jobs process's
 * `components.downloads` events).
 * - Done: the set goes from `downloading` to `ready`. "Taalcut is ready"; a click brings the app forward. A launch
 *   that finds everything here says nothing.
 * - Stopped (downloads-stop.ts): the set stops with something the person has to deal with, once per stop, never per
 *   retry. It names the jobs left without their models and says why; a click opens Settings › Models on the first
 *   one's row. A run that ends is always said; a refusal to start is said only while no Taalcut window has focus,
 *   since a refusal with a window in front is the answer to what the person just pressed there, and that window
 *   already shows it.
 * Whether a notification shows at all is the person's macOS setting for Taalcut (System Settings › Notifications),
 * which the system applies. Electron is injected (downloads-notify-electron.ts wires it), so this is unit-tested.
 */
import type { I18n } from '@lingui/core';
import type { ComponentJob, Downloads, EventBus } from '@taalcut/core';
import { DOWNLOADS_NOTIFY_MESSAGES } from '../i18n/downloads-messages';
import type { NotificationLike } from '../render/render-notify';
import { stopNotice, stopOf } from './downloads-stop';

export interface DownloadsNotifyDeps {
  readonly events: Pick<EventBus, 'on'>;
  /** Main's words in the app's language, and that language (a stop's title lists jobs the language's way). */
  readonly i18n: Pick<I18n, '_' | 'locale'>;
  /** Notification.isSupported(). */
  readonly isSupported: () => boolean;
  readonly create: (options: { readonly title: string; readonly body: string }) => NotificationLike;
  /** Whether a Taalcut window has focus now. */
  readonly windowFocused: () => boolean;
  /** Shows and focuses the main window. */
  readonly focus: () => void;
  /** Shows the main window on Settings › Models, at that job's row when one is named. */
  readonly showDownloads: (job: ComponentJob | undefined) => void;
}

/** Starts listening; returns the unsubscribe. */
export function startDownloadsNotifications(deps: DownloadsNotifyDeps): () => void {
  // Electron drops a notification's click handler if the object is collected, so keep each until it closes.
  const live = new Set<NotificationLike>();
  const post = (texts: { readonly title: string; readonly body: string }, onClick: () => void): void => {
    const notification = deps.create(texts);
    live.add(notification);
    notification.on('click', () => {
      live.delete(notification);
      onClick();
    });
    notification.on('close', () => live.delete(notification));
    notification.show();
  };
  let last: Downloads | undefined;
  return deps.events.on('components.downloads', ({ payload }) => {
    const previous = last;
    last = payload;
    if (!deps.isSupported()) return;
    if (previous?.state === 'downloading' && payload.state === 'ready') {
      post(
        {
          title: deps.i18n._(DOWNLOADS_NOTIFY_MESSAGES.ready.title),
          body: deps.i18n._(DOWNLOADS_NOTIFY_MESSAGES.ready.body),
        },
        deps.focus,
      );
      return;
    }
    const stop = stopOf(previous, payload);
    if (!stop || (!stop.ran && deps.windowFocused())) return;
    post(stopNotice(deps.i18n, stop), () => deps.showDownloads(stop.job));
  });
}
