// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { DeviceView } from '@taalcut/core';
import type { PhoneTransfer } from './phone-types';

type DevicesIterator = AsyncIterator<{ readonly devices: readonly DeviceView[] }>;

const openIterators = new WeakMap<AbortController, DevicesIterator>();

function closeOnAbort(controller: AbortController, iterator: DevicesIterator): void {
  const finish = (): void => {
    openIterators.delete(controller);
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
  };
  if (controller.signal.aborted) finish();
  else controller.signal.addEventListener('abort', finish, { once: true });
}

/** USB discovery starts asynchronously; its first empty snapshot is not the detected-device result. */
export async function discoverPhones(
  transfer: PhoneTransfer,
  controller: AbortController,
  deviceKey?: string,
  timeoutMs = 5000,
): Promise<readonly DeviceView[]> {
  const stream = await transfer.devices(undefined, { signal: controller.signal });
  const iterator = stream[Symbol.asyncIterator]();
  openIterators.set(controller, iterator);
  closeOnAbort(controller, iterator);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), timeoutMs);
  });
  let latest: readonly DeviceView[] = [];
  try {
    for (;;) {
      const next = await Promise.race([iterator.next(), expired]);
      if (!next) return latest;
      if (next.done) {
        openIterators.delete(controller);
        return latest;
      }
      latest = next.value.devices;
      if (
        latest.some(
          (device) =>
            device.connected && device.access !== 'opening' && (!deviceKey || device.key === deviceKey),
        )
      )
        return latest;
    }
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Connected drafts retain the USB observer: the transport otherwise drops their thumbnail cache. */
export function createPhoneDiscoveryRetention() {
  const active = new Map<string, { controller: AbortController; settled: Promise<void> }>();
  return {
    async hold(transfer: PhoneTransfer, key: string, controller: AbortController) {
      let iterator = openIterators.get(controller);
      openIterators.delete(controller);
      if (!iterator) {
        const stream = await transfer.devices(undefined, { signal: controller.signal });
        iterator = stream[Symbol.asyncIterator]();
        closeOnAbort(controller, iterator);
        await iterator.next();
      }
      const heldIterator = iterator;
      const previous = active.get(key);
      const settled = (async () => {
        try {
          while (!(await heldIterator.next()).done) {
            /* Drain snapshots while the draft remains connected. */
          }
        } catch {
          /* Closing the observer ends its cache lease. */
        } finally {
          await Promise.resolve(heldIterator.return?.()).catch(() => undefined);
        }
      })();
      active.set(key, { controller, settled });
      if (previous && previous.controller !== controller) {
        previous.controller.abort();
        await previous.settled;
      }
    },
    async close() {
      for (const observer of active.values()) observer.controller.abort();
      await Promise.all([...active.values()].map((observer) => observer.settled));
      active.clear();
    },
  };
}
