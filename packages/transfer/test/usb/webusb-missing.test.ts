// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A `usb` addon that won't load ends the watch with an error the devices stream can show. */
import { describe, expect, it, vi } from 'vitest';
import { isTaalcutError } from '@taalcut/core';
import { createWebUsbWatcher } from '../../src/usb-watch/webusb-watch';

vi.mock('usb', () => {
  throw new Error('dlopen failed: a damaged install');
});

describe('WebUSB watcher without its addon', () => {
  it('fails the watch with transfer.bridge_failed instead of listing nothing', async () => {
    const iter = createWebUsbWatcher().watch(new AbortController().signal)[Symbol.asyncIterator]();
    const failure: unknown = await iter.next().then(
      () => null,
      (cause: unknown) => cause,
    );
    expect(isTaalcutError(failure)).toBe(true);
    if (!isTaalcutError(failure)) return;
    expect(failure.code).toBe('transfer.bridge_failed');
    expect(failure.detail).toBe('usb.addon_unavailable');
  });
});
