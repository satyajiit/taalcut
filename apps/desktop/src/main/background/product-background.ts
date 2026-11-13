// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  createToken,
  defineSetting,
  ok,
  type AsyncResult,
  type ProductBackgroundStatus,
  type SettingsStore,
} from '@taalcut/core';
import { z } from 'zod';
import { type NativeRegistration, type RegistrationState } from './native-registration';

export const PRODUCT_BACKGROUND_ENABLED = defineSetting('products.background.enabled', z.boolean(), false);
export type { ProductBackgroundStatus } from '@taalcut/core';
export interface ProductBackgroundDeps {
  readonly settings: SettingsStore;
  readonly registration: NativeRegistration;
  /** Dispatches the products wake command to the existing agent utility process. */
  readonly run: () => Promise<void>;
  readonly onError?: (code: string) => void;
  readonly intervalMs?: number;
}

/** Only a wake coordinator. The existing utility jobs owner retains all execution and concurrency ownership. */
export async function createProductBackground(deps: ProductBackgroundDeps) {
  const saved = await deps.settings.get(PRODUCT_BACKGROUND_ENABLED);
  let enabled = saved.ok && saved.value;
  let disposed = false;
  let running: Promise<void> | undefined;
  let again = false;
  let changing: Promise<unknown> = Promise.resolve();

  function snapshot(registration: RegistrationState, detail: string | null = null): ProductBackgroundStatus {
    const states = {
      enabled: 'enabled',
      'requires-approval': 'approval-required',
      'not-registered': 'disabled',
      unsupported: 'unavailable',
      failed: 'failed',
    } as const;
    return {
      enabled,
      supported: registration !== 'unsupported',
      registration: states[registration],
      detail,
    };
  }

  function wake(): Promise<void> {
    if (!enabled || disposed) return Promise.resolve();
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        if (!enabled || disposed) return;
        try {
          await deps.run();
        } catch {
          deps.onError?.('products.background_wake_failed');
        }
      } while (again && enabled && !disposed);
    })().finally(() => {
      running = undefined;
    });
    return running;
  }

  async function status(): AsyncResult<ProductBackgroundStatus> {
    const registration = await deps.registration.status();
    return ok(registration.ok ? snapshot(registration.value) : snapshot('failed', registration.error.code));
  }

  async function change(value: boolean): AsyncResult<ProductBackgroundStatus> {
    // Disabling work wins even if the OS refuses to unregister; report that refusal so it can be retried.
    if (!value) {
      enabled = false;
      const stopped = await deps.settings.set(PRODUCT_BACKGROUND_ENABLED, false);
      if (!stopped.ok) return stopped;
    }
    const registered = await deps.registration.setEnabled(value);
    if (!registered.ok) {
      return registered;
    }
    const persisted = await deps.settings.set(PRODUCT_BACKGROUND_ENABLED, value);
    if (!persisted.ok) {
      if (value) await deps.registration.setEnabled(false);
      return persisted;
    }
    enabled = value;
    if (enabled) void wake();
    return ok(snapshot(registered.value));
  }

  function setEnabled(value: boolean): AsyncResult<ProductBackgroundStatus> {
    const result = changing.then(() => change(value));
    changing = result.then(() => undefined);
    return result;
  }

  const timer = setInterval(
    () => {
      void wake();
    },
    Math.max(1000, deps.intervalMs ?? 60_000),
  );
  timer.unref();
  // Observe revoked OS approval; do not silently re-enable a background item that System Settings disabled.
  return {
    enabled: () => enabled,
    wake,
    status,
    setEnabled,
    stop: () => setEnabled(false),
    dispose() {
      disposed = true;
      clearInterval(timer);
    },
  };
}

export type ProductBackground = Awaited<ReturnType<typeof createProductBackground>>;
export const ProductBackgroundToken = createToken<ProductBackground>('desktop.productBackground');
