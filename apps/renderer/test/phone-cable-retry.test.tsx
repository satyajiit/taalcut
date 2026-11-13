// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { I18nProvider } from '@lingui/react';
import type { DevicesState, DeviceView } from '@taalcut/core';
import { HostPlatformProvider } from '@taalcut/ui';
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BackendProvider, type Backend } from '../src/backend/backend';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { watched } from '../src/backend/fake/watch';
import { CableWorkspace } from '../src/features/library/phone/connect/cable-workspace';
import { CableSource } from '../src/onboarding/setup/sources/cable-source';
import { canRetryDeviceAccess } from '../src/onboarding/setup/sources/device-words';
import { activateLocale, i18n } from '../src/i18n/i18n';

async function show(surface: 'library' | 'onboarding', platform: DeviceView['platform'] = 'android') {
  await activateLocale('en', 'mac');
  let device: DeviceView = {
    key: 'ZYXWVUTSRQPNMKJH',
    label: 'Phone',
    platform,
    bridge: 'image-capture',
    access: 'locked',
    connected: true,
  };
  const devices = watched<DevicesState>(() => ({ devices: [device], runs: [] }));
  const onConnect = vi.fn();
  const openDevice = vi.fn(async () => {
    device = { ...device, access: 'ready' };
    devices.notify();
    return device;
  });
  const fake = createFakeBackend();
  vi.spyOn(fake.controls.phase3.devices.watch, 'stream').mockImplementation((signal) =>
    devices.stream(signal),
  );
  const backend: Backend = {
    ...fake.client,
    transfer: {
      ...fake.client.transfer,
      devices: fake.client.transfer.devices,
      openDevice,
      deviceSummary: async () => ({ items: 1, bytes: 1024, newItems: 1, months: [], albums: [] }),
    },
  };
  const root = createRootRoute({
    component: () =>
      surface === 'library' ? (
        <CableWorkspace pending={false} error={null} onConnect={onConnect} />
      ) : (
        <CableSource runId={null} onStarted={() => {}} />
      ),
  });
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ['/'] }) });
  await act(async () => {
    render(
      <I18nProvider i18n={i18n}>
        <HostPlatformProvider platform="mac">
          <BackendProvider backend={backend}>
            <RouterProvider router={router} />
          </BackendProvider>
        </HostPlatformProvider>
      </I18nProvider>,
    );
    await router.load();
  });
  return { openDevice, onConnect, key: device.key };
}

describe('phone access retry', () => {
  it.each(['library', 'onboarding'] as const)(
    'reopens the unlocked Android phone from %s',
    async (surface) => {
      const test = await show(surface);
      expect(
        (await screen.findAllByText('On your phone, tap the USB notification and choose File transfer.'))
          .length,
      ).toBeGreaterThan(0);
      expect(test.openDevice).not.toHaveBeenCalled();
      fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
      await waitFor(() => expect(test.openDevice).toHaveBeenCalledWith({ deviceKey: test.key }));
      if (surface === 'library') await waitFor(() => expect(test.onConnect).toHaveBeenCalledWith(test.key));
      else expect(await screen.findByRole('button', { name: /Import 1 clip/ })).toBeTruthy();
    },
  );

  it.each(['library', 'onboarding'] as const)(
    'keeps the iPhone unlock prompt automatic in %s',
    async (surface) => {
      const test = await show(surface, 'ios');
      expect((await screen.findAllByText('Unlock your iPhone to carry on.')).length).toBeGreaterThan(0);
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(test.openDevice).not.toHaveBeenCalled();
    },
  );

  it('offers retry after Android storage prompts while keeping unsupported and opening states separate', () => {
    for (const access of ['locked', 'needs-file-transfer', 'not-trusted', 'busy'] as const)
      expect(canRetryDeviceAccess({ platform: 'android', access })).toBe(true);
    expect(canRetryDeviceAccess({ platform: 'other', access: 'locked' })).toBe(true);
    for (const access of ['ready', 'opening', 'unsupported'] as const)
      expect(canRetryDeviceAccess({ platform: 'android', access })).toBe(false);
    expect(canRetryDeviceAccess({ platform: 'ios', access: 'busy' })).toBe(true);
  });
});
