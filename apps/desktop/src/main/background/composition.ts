// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { I18n } from '@lingui/core';
import { callRpc, type ProductId, type SettingsStore } from '@taalcut/core';
import { app, Notification } from 'electron';
import { hostPlatformName } from '../../platform/names';
import type { UtilityHost } from '../rpc/utility-host';
import { createNativeRegistration } from './native-registration';
import { createProductBackground } from './product-background';
import { createProductNotifications } from './notifications';

export async function createDesktopProductBackground(deps: {
  readonly settings: SettingsStore;
  readonly host: Pick<UtilityHost, 'client'>;
  readonly i18n: Pick<I18n, '_'>;
  readonly userData: string;
  readonly packaged: boolean;
  readonly openProduct: (productId: ProductId) => void;
}) {
  const notices = createProductNotifications({
    settings: deps.settings,
    i18n: deps.i18n,
    openProduct: deps.openProduct,
    isSupported: () => Notification.isSupported(),
    create: (options) => new Notification({ ...options, silent: false }),
  });
  return createProductBackground({
    settings: deps.settings,
    registration: createNativeRegistration({
      platform: hostPlatformName(),
      packaged: deps.packaged,
      executable: process.execPath,
      userData: deps.userData,
      loginItems: app,
    }),
    async run() {
      const agent = deps.host.client('agent');
      const woke = await callRpc(agent.productWake.wake({}));
      if (!woke.ok) console.warn(`[products] wake: ${woke.error.code}`);
      const activity = await callRpc(agent.products.activity({ unreadOnly: true }));
      if (!activity.ok) {
        console.warn(`[products] activity: ${activity.error.code}`);
        return;
      }
      for (const notification of activity.value.items) {
        const shown = await notices.showSaved(notification);
        if (!shown.ok) console.warn(`[products] notification: ${shown.error.code}`);
      }
    },
    onError: (code) => console.warn(`[products] ${code}`),
  });
}
