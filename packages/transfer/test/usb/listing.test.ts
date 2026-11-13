// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Draining a bridge's listing: its own errors survive, anything else means the phone went away. */
import { describe, expect, it } from 'vitest';
import type { DeviceItem } from '../../src/usb/bridge';
import { BridgeFailed } from '../../src/usb/errors';
import { drainListing } from '../../src/usb/listing';

function item(id: string): DeviceItem {
  return {
    id,
    name: `${id}.jpg`,
    kind: 'image',
    sizeBytes: 10,
    createdAt: 1,
    modifiedAt: null,
    width: null,
    height: null,
    durationMs: null,
    type: 'image/jpeg',
    folder: null,
    album: null,
    flags: {},
    sidecars: [],
    availability: 'local',
  };
}

async function* pages(fail: unknown): AsyncGenerator<readonly DeviceItem[]> {
  yield [item('a'), item('b')];
  throw fail;
}

describe('drainListing', () => {
  it('collects every page', async () => {
    async function* two(): AsyncGenerator<readonly DeviceItem[]> {
      yield [item('a')];
      yield [item('b'), item('c')];
    }
    const drained = await drainListing(two(), new AbortController().signal);
    expect(drained.ok && drained.value.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
  });

  it("keeps a bridge's own error", async () => {
    const drained = await drainListing(
      pages(BridgeFailed(undefined, { detail: 'devices.catalog_timeout' })),
      new AbortController().signal,
    );
    expect(drained.ok).toBe(false);
    if (!drained.ok) {
      expect(drained.error.code).toBe('transfer.bridge_failed');
      expect(drained.error.detail).toBe('devices.catalog_timeout');
    }
  });

  it('turns anything else into device gone', async () => {
    const drained = await drainListing(
      pages(new Error('LIBUSB_ERROR_NO_DEVICE')),
      new AbortController().signal,
    );
    expect(!drained.ok && drained.error.code).toBe('transfer.device_gone');
  });
});
