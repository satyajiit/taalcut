// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  defineSetting,
  ok,
  type AsyncResult,
  type ProductNotification,
  type SettingsStore,
} from '@taalcut/core';
import { z } from 'zod';
import type { I18n } from '@lingui/core';
import type { NotificationLike } from '../render/render-notify';
import { PRODUCT_NOTIFY_MESSAGES } from '../i18n/product-messages';

const DELIVERED_NOTICES = defineSetting('products.notifications.delivered', z.array(z.string()).max(256), []);
export interface ProductNotificationsDeps {
  readonly settings: SettingsStore;
  readonly i18n: Pick<I18n, '_'>;
  readonly isSupported: () => boolean;
  readonly create: (options: { title: string; body: string }) => NotificationLike;
  readonly openProduct: (productId: ProductNotification['productId']) => void;
}

/** The worker commits the inbox entry first. Native delivery is best effort; the inbox remains authoritative. */
export function createProductNotifications(deps: ProductNotificationsDeps) {
  const live = new Set<NotificationLike>();
  let serial: Promise<unknown> = Promise.resolve();
  async function deliver(notification: ProductNotification): AsyncResult<void> {
    if (notification.readAt !== null || !deps.isSupported()) return ok(undefined);
    const remembered = await deps.settings.get(DELIVERED_NOTICES);
    if (!remembered.ok) return remembered;
    if (remembered.value.includes(notification.id)) return ok(undefined);
    // Mark before showing: a crash cannot spam the same message on every timer wake. The durable inbox covers
    // a crash between this write and the OS notification, or OS permission denial / Do Not Disturb.
    const saved = await deps.settings.set(
      DELIVERED_NOTICES,
      [...remembered.value, notification.id].slice(-256),
    );
    if (!saved.ok) return saved;
    try {
      const words = PRODUCT_NOTIFY_MESSAGES[notification.kind];
      const notice = deps.create({ title: deps.i18n._(words.title), body: deps.i18n._(words.body) });
      live.add(notice);
      notice.on('click', () => {
        live.delete(notice);
        deps.openProduct(notification.productId);
      });
      notice.on('close', () => live.delete(notice));
      notice.show();
    } catch {
      /* Notification permission does not affect the saved inbox or successful work. */
    }
    return ok(undefined);
  }
  return {
    showSaved(notification: ProductNotification): AsyncResult<void> {
      const result = serial.then(() => deliver(notification));
      serial = result.then(() => undefined);
      return result;
    },
  };
}
