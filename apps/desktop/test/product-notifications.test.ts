// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { setupI18n } from '@lingui/core';
import { createMemorySettingsStore, newId, type ProductNotification } from '@taalcut/core';
import { describe, expect, it, vi } from 'vitest';
import { createProductNotifications } from '../src/main/background/notifications';

function notice(): ProductNotification {
  return {
    id: newId<'ProductNotification'>(),
    productId: newId<'Product'>(),
    campaignId: null,
    kind: 'draft-ready',
    title: 'Internal stored title',
    body: 'Stored details',
    createdAt: 100,
    readAt: null,
  };
}

describe('product native notifications', () => {
  it('localizes chrome, opens the product and dedupes across main-process restarts', async () => {
    const callbacks = new Map<string, () => void>();
    const show = vi.fn();
    const create = vi.fn(() => ({ show, on: (event: string, fn: () => void) => callbacks.set(event, fn) }));
    const deps = {
      settings: createMemorySettingsStore(),
      i18n: setupI18n({ locale: 'en', messages: {} }),
      isSupported: () => true,
      create,
      openProduct: vi.fn(),
    };
    const notification = notice();
    const service = createProductNotifications(deps);
    await Promise.all([service.showSaved(notification), service.showSaved(notification)]);
    expect(show).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      title: 'Your product video is ready to review',
      body: 'Watch the draft and ask Taal for changes.',
    });
    callbacks.get('click')?.();
    expect(deps.openProduct).toHaveBeenCalledWith(notification.productId);
    await createProductNotifications(deps).showSaved(notification);
    expect(show).toHaveBeenCalledTimes(1);
  });
  it('does not let OS denial change the already-saved inbox or successful work', async () => {
    const notification = notice();
    const service = createProductNotifications({
      settings: createMemorySettingsStore(),
      i18n: setupI18n({ locale: 'en', messages: {} }),
      isSupported: () => true,
      create: () => {
        throw new Error('Permission denied');
      },
      openProduct: vi.fn(),
    });
    expect(await service.showSaved(notification)).toEqual({ ok: true, value: undefined });
    expect(notification.readAt).toBeNull();
  });
});
