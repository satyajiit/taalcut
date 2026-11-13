// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** A camera roll past the listing limit ends in too_many_items, not a silently cut list. */
import { describe, expect, it } from 'vitest';
import { createMtpBridge } from '../../../src/bridges/mtp/bridge';
import { TRANSFER_LIMITS } from '../../../src/limits';
import type { BridgeDeviceRef } from '../../../src/usb/bridge';
import { drainListing } from '../../../src/usb/listing';
import { bytesBody, createMemoryPipe, folder, type MemoryObject } from './memory-pipe';

const REF: BridgeDeviceRef = {
  bridge: 'mtp',
  handle: 'loc',
  identity: 'serial',
  label: 'Pixel',
  platform: 'android',
};

describe('MTP listing limit', () => {
  it('stops one item past the limit so the drain answers too_many_items', async () => {
    const body = bytesBody(Uint8Array.of(0xff, 0xd8, 0xff, 0xd9));
    const objects: MemoryObject[] = [folder(1, 0, 'DCIM')];
    for (let index = 0; index < TRANSFER_LIMITS.usbMaxItems + 50; index += 1) {
      const handle = 10 + index;
      objects.push({
        handle,
        storageId: 1,
        parent: 1,
        format: 0x3801,
        name: `IMG_${handle}.jpg`,
        created: '20240601T120000',
        modified: '20240601T120000',
        body,
        width: 0,
        height: 0,
      });
    }
    const pipe = createMemoryPipe(objects);
    const opened = await createMtpBridge({ openPipe: async () => pipe }).open(
      REF,
      new AbortController().signal,
    );
    expect(opened.ok).toBe(true);
    if (!opened.ok) return;
    const signal = new AbortController().signal;
    const drained = await drainListing(opened.value.list(signal), signal);
    expect(drained.ok ? null : drained.error.code).toBe('transfer.too_many_items');
    await opened.value.close();
  }, 60_000);
});
