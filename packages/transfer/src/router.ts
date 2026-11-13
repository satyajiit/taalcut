// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  deviceProcedures,
  NotImplementedError,
  implementContract,
  notServedRouter,
  transferContract,
  unwrapRpc,
} from '@taalcut/core';
import type { TransferService } from './service';
import type { DeviceService } from './usb/bridge';

const never = new AbortController().signal;

/** Serves `transferContract`. Pass `devices` once USB import is composed; otherwise those procedures stay unserved. */
export function transferRouter(service: TransferService, devices?: DeviceService) {
  const os = implementContract(transferContract);
  const usb = devices
    ? {
        deviceRunItems: os.deviceRunItems.handler(async ({ input }) => {
          if (!devices.deviceRunItems) throw NotImplementedError({ feature: 'device receipts' });
          return unwrapRpc(await devices.deviceRunItems(input));
        }),
        devices: os.devices.handler(async function* ({ signal }) {
          yield* devices.devices(signal ?? never);
        }),
        openDevice: os.openDevice.handler(async ({ input, signal }) =>
          unwrapRpc(await devices.openDevice(input.deviceKey, signal ?? never)),
        ),
        deviceItems: os.deviceItems.handler(async ({ input, signal }) => {
          const page = unwrapRpc(await devices.deviceItems(input, signal ?? never));
          return {
            items: page.items.map((item) => ({ ...item, flags: [...item.flags] })),
            nextCursor: page.nextCursor,
            total: page.total,
          };
        }),
        deviceSummary: os.deviceSummary.handler(async ({ input, signal }) => {
          const summary = unwrapRpc(await devices.deviceSummary(input, signal ?? never));
          return {
            ...summary,
            months: summary.months.map((month) => ({ ...month })),
            albums: summary.albums.map((album) => ({ ...album })),
          };
        }),
        importFromDevice: os.importFromDevice.handler(async ({ input, signal }) =>
          unwrapRpc(await devices.importFromDevice(input, signal ?? never)),
        ),
        deviceRun: os.deviceRun.handler(async function* ({ input, signal }) {
          yield* devices.deviceRun(input.runId, signal ?? never);
        }),
        pauseDeviceImport: os.pauseDeviceImport.handler(async ({ input }) =>
          unwrapRpc(await devices.pauseDeviceImport(input.runId)),
        ),
        resumeDeviceImport: os.resumeDeviceImport.handler(async ({ input }) =>
          unwrapRpc(await devices.resumeDeviceImport(input.runId)),
        ),
        cancelDeviceImport: os.cancelDeviceImport.handler(async ({ input }) =>
          unwrapRpc(await devices.cancelDeviceImport(input.runId)),
        ),
        forgetUsbDebugKey: os.forgetUsbDebugKey.handler(async () =>
          unwrapRpc(await devices.forgetUsbDebugKey()),
        ),
      }
    : notServedRouter(deviceProcedures, 'transfer.usb');
  return os.router({
    open: os.open.handler(async function* ({ input, signal }) {
      yield* service.open(input, signal ?? never);
    }),
    close: os.close.handler(async ({ input }) => service.close(input.sessionId)),
    newPairing: os.newPairing.handler(async ({ input }) => service.newPairing(input.sessionId)),
    answerApproval: os.answerApproval.handler(async ({ input }) =>
      service.answerApproval(input.sessionId, input.approvalId, input.allow),
    ),
    disconnect: os.disconnect.handler(async ({ input }) =>
      service.disconnect(input.sessionId, input.deviceId),
    ),
    cancelUpload: os.cancelUpload.handler(async ({ input }) =>
      service.cancelUpload(input.sessionId, input.uploadId),
    ),
    interfaces: os.interfaces.handler(async () => service.interfaces()),
    forgetDevices: os.forgetDevices.handler(async () => service.forgetDevices()),
    ...usb,
  });
}
