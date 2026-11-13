// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  deviceThumbUrl,
  err,
  fromRpcError,
  ok,
  ValidationError,
  type AsyncResult,
  type DeviceItemView,
  type DeviceView,
  type ImportSource,
  type TaalcutError,
} from '@taalcut/core';
import type { ImportAdapter, PreparedImportItem } from '@taalcut/library';
import { DeviceBusy, DeviceGone, DeviceLocked, DeviceUnsupported } from '@taalcut/transfer';
import { runPhoneImport } from './phone-run';
import { discoverPhones, createPhoneDiscoveryRetention } from './phone-discovery';

import type { PhoneImportOptions, PhoneTransfer } from './phone-types';
export type { PhoneImportOptions, PhoneTransfer } from './phone-types';
const filter = () => ({ onlyNew: false, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });

function deviceAccessError(view: DeviceView): TaalcutError {
  if (!view.connected) return DeviceGone();
  if (
    view.access === 'locked' ||
    view.access === 'not-trusted' ||
    view.access === 'needs-file-transfer' ||
    view.access === 'needs-debugging-allow'
  ) {
    return DeviceLocked(undefined, { detail: view.access });
  }
  if (view.access === 'busy') return DeviceBusy(undefined, { detail: view.busyHolder ?? 'unknown' });
  if (view.access === 'unsupported') return DeviceUnsupported();
  return DeviceGone();
}

/** Discovery does not open a phone or ask for Trust/Allow. The subscription lives only for its snapshot. */
export async function phoneImportSources(transfer: PhoneTransfer): Promise<ImportSource[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1000);
  try {
    const devices = await discoverPhones(transfer, controller, undefined, 250);
    return devices.map((device) => ({
      id: device.key,
      method: 'phone-cable' as const,
      label: device.label,
      available: device.connected,
      status: device.access === 'ready' ? null : device.access,
    }));
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
function itemDisplayName(item: DeviceItemView): string {
  const album = item.album?.trim();
  return album && !item.name.includes('/') ? `${album}/${item.name}` : item.name;
}
function preparedItem(deviceKey: string, item: DeviceItemView): PreparedImportItem {
  return {
    item: {
      id: item.key,
      name: itemDisplayName(item),
      sizeBytes: item.imported === 'in-icloud' ? null : item.sizeBytes,
      capturedAt: item.createdAt,
      thumbnailUrl: deviceThumbUrl(deviceKey, item.key),
      duplicate: item.imported === 'yes',
      captureId: null,
      required: true,
      supported: item.imported !== 'in-icloud',
      warning: item.imported === 'in-icloud' ? 'cloud-original-unavailable' : null,
    },
    locator: { key: item.key, sizeBytes: item.sizeBytes, createdAt: item.createdAt },
  };
}
async function catalogue(
  transfer: PhoneTransfer,
  deviceKey: string,
  signal: AbortSignal,
): AsyncResult<DeviceItemView[]> {
  const items: DeviceItemView[] = [];
  let cursor: string | undefined;
  do {
    const page = await callRpc(
      transfer.deviceItems(
        { deviceKey, filter: filter(), limit: 500, ...(cursor ? { cursor } : {}) },
        { signal },
      ),
    );
    if (!page.ok) return page;
    items.push(...page.value.items);
    cursor = page.value.nextCursor;
  } while (cursor);
  return ok(items);
}
export function createPhoneImportAdapter(options: PhoneImportOptions): ImportAdapter {
  const observers = createPhoneDiscoveryRetention();
  return {
    close: observers.close,
    capabilities: { pause: true, resume: true, cancel: true, retryFailed: true, byteResume: false },
    async prepare(input) {
      const controller = new AbortController();
      let retained = false;
      try {
        const transfer = options.transfer();
        const devices = (await discoverPhones(transfer, controller, input.deviceId)).filter(
          (device) => device.connected,
        );
        const device = input.deviceId
          ? devices.find((value) => value.key === input.deviceId)
          : devices.length === 1
            ? devices[0]
            : undefined;
        if (!device) {
          return err(devices.length > 1 && !input.deviceId ? ValidationError({ field: 'deviceId' }) : DeviceGone());
        }
        const opened = await callRpc(
          transfer.openDevice({ deviceKey: device.key }, { signal: controller.signal }),
        );
        if (!opened.ok) return opened;
        if (opened.value.access !== 'ready') return err(deviceAccessError(opened.value));
        const listed = await catalogue(transfer, device.key, controller.signal);
        if (!listed.ok) return listed;
        await observers.hold(transfer, device.key, controller);
        retained = true;
        return ok({
          sourceLabel: device.label,
          destinationLabel:
            typeof options.destinationLabel === 'string'
              ? options.destinationLabel
              : await options.destinationLabel(),
          items: listed.value.map((item) => preparedItem(device.key, item)),
          privateData: { deviceKey: device.key },
          selectAll: false,
        });
      } catch (cause) {
        return err(fromRpcError(cause));
      } finally {
        if (!retained) controller.abort();
      }
    },
    async preflight(_draft, items, privateData, mode) {
      const deviceKey = (privateData as { deviceKey: string }).deviceKey;
      const controller = new AbortController();
      let retained = false;
      try {
        const transfer = options.transfer();
        const devices = await discoverPhones(transfer, controller, deviceKey);
        if (!devices.some((device) => device.key === deviceKey && device.connected))
          return ok({ canStart: false, warnings: ['source-reconnect-required'] });
        if (mode?.starting) {
          const opened = await callRpc(transfer.openDevice({ deviceKey }, { signal: controller.signal }));
          if (!opened.ok) return opened;
        }
        const current = await catalogue(transfer, deviceKey, controller.signal);
        if (!current.ok)
          return mode?.starting
            ? current
            : ok({ canStart: items.length > 0, warnings: ['source-reconnect-required'] });
        const byId = new Map(current.value.map((item) => [item.key, item]));
        for (const selected of items) {
          const found = byId.get(selected.item.id);
          if (
            !found ||
            (found.name !== selected.item.name && itemDisplayName(found) !== selected.item.name) ||
            found.sizeBytes !== selected.item.sizeBytes ||
            found.createdAt !== selected.item.capturedAt
          )
            return err(ValidationError({ field: 'sourceChanged' }));
        }
        if (mode?.starting) {
          await observers.hold(transfer, deviceKey, controller);
          retained = true;
        }
        return ok({ canStart: items.length > 0, warnings: ['current-file-restarts-on-resume'] });
      } catch (cause) {
        return err(fromRpcError(cause));
      } finally {
        if (!retained) controller.abort();
      }
    },
    run: (context) => runPhoneImport(options.transfer(), context),
  };
}
