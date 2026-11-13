// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createMemorySettingsStore, err, ok } from '@taalcut/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backgroundLaunchIntents,
  foregroundWindow,
  isBackgroundLaunch,
} from '../src/main/background/lifecycle';
import {
  createProductBackground,
  PRODUCT_BACKGROUND_ENABLED,
} from '../src/main/background/product-background';
import {
  BackgroundRegistrationFailed,
  type NativeRegistration,
  type RegistrationState,
} from '../src/main/background/native-registration';

afterEach(() => vi.useRealTimers());

describe('background launch lifecycle', () => {
  it('opens and reuses only the foreground window while background renders may have their own windows', () => {
    let destroyed = false;
    const window = {
      isDestroyed: () => destroyed,
      isMinimized: () => true,
      restore: vi.fn(),
      focus: vi.fn(),
    };
    const create = vi.fn(() => window);
    const focusItem = vi.fn();
    const foreground = foregroundWindow({ create, focusItem });
    expect(foreground.show('first')).toEqual({ window, created: true });
    expect(create).toHaveBeenCalledWith('first');
    expect(foreground.show('second').created).toBe(false);
    expect(window.restore).toHaveBeenCalledOnce();
    expect(focusItem).toHaveBeenCalledWith('second');
    destroyed = true;
    expect(foreground.show().created).toBe(true);
    expect(create).toHaveBeenCalledTimes(2);
  });
  it('buffers ordinary open requests separately from coalesced native wakes', () => {
    const intents = backgroundLaunchIntents();
    const open = vi.fn();
    const wake = vi.fn();
    intents.receive(['app', '--taalcut-background']);
    intents.receive(['app', '--taalcut-background']);
    intents.receive(['app']);
    intents.bind({ open, wake });
    expect(wake).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledTimes(1);
    intents.receive(['app', '--taalcut-background']);
    expect(open).toHaveBeenCalledTimes(1);
    expect(isBackgroundLaunch(['app', '--taalcut-background-fake'])).toBe(false);
  });
  it('keeps background intent across app disposal but unregisters on explicit stop', async () => {
    vi.useFakeTimers();
    const settings = createMemorySettingsStore();
    let state: RegistrationState = 'not-registered';
    const registration: NativeRegistration = {
      status: async () => ok(state),
      setEnabled: vi.fn(async (value) => {
        state = value ? 'enabled' : 'not-registered';
        return ok(state);
      }),
    };
    const run = vi.fn(async () => undefined);
    const background = await createProductBackground({ settings, registration, run });
    expect(background.enabled()).toBe(false);
    expect(await background.setEnabled(true)).toEqual(
      ok({ enabled: true, supported: true, registration: 'enabled', detail: null }),
    );
    await background.wake();
    background.dispose();
    expect(await settings.get(PRODUCT_BACKGROUND_ENABLED)).toEqual(ok(true));
    const restored = await createProductBackground({ settings, registration, run });
    expect(restored.enabled()).toBe(true);
    await restored.stop();
    expect(registration.setEnabled).toHaveBeenLastCalledWith(false);
    expect(await settings.get(PRODUCT_BACKGROUND_ENABLED)).toEqual(ok(false));
    restored.dispose();
  });
  it('coalesces timer and resume wakes while work is running', async () => {
    vi.useFakeTimers();
    const settings = createMemorySettingsStore();
    await settings.set(PRODUCT_BACKGROUND_ENABLED, true);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = vi.fn(async () => {
      await barrier;
    });
    const background = await createProductBackground({
      settings,
      registration: {
        status: async () => ok('enabled'),
        setEnabled: async () => ok('enabled'),
      },
      run,
    });
    const first = background.wake();
    background.wake();
    background.wake();
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    expect(run).toHaveBeenCalledTimes(2);
    background.dispose();
  });
  it('surfaces unavailable OS registration while keeping explicit stop durable', async () => {
    const settings = createMemorySettingsStore();
    await settings.set(PRODUCT_BACKGROUND_ENABLED, true);
    const failure = err(BackgroundRegistrationFailed({}));
    const background = await createProductBackground({
      settings,
      run: vi.fn(async () => undefined),
      registration: { status: async () => failure, setEnabled: async () => failure },
    });
    expect(await background.status()).toEqual(
      ok({
        enabled: true,
        supported: true,
        registration: 'failed',
        detail: 'desktop.background_registration_failed',
      }),
    );
    expect(await background.stop()).toEqual(failure);
    expect(background.enabled()).toBe(false);
    expect(await settings.get(PRODUCT_BACKGROUND_ENABLED)).toEqual(ok(false));
    background.dispose();
  });
});
