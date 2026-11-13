// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Loads the shipped N-API addon under Electron's hardened runtime, without claiming any device. */
export async function usbSelfTest(): Promise<Record<string, unknown>> {
  const { usb } = await import('usb');
  const devices = await usb.getDevices();
  const report = process.report.getReport() as unknown as { sharedObjects?: string[] };
  return {
    electron: process.versions.electron,
    deviceCount: devices.length,
    loaded: (report.sharedObjects ?? []).filter((path) => /@node-usb/.test(path)),
  };
}
