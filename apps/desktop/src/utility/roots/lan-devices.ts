// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * USB in the lan process (P3-B4, P3-B5): adb, MTP, then Image Capture.
 * The `usb` addon is loaded once. If it does not load, cable import is off
 * and Wi-Fi transfer still composes. This process is the only one that
 * claims USB interfaces. Off a Mac (PlatformAbilities.cableImport) nothing is
 * loaded or claimed: every call answers `desktop.cable_unsupported` (UX3-MAC).
 */
import { mkdir, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import {
  defineError,
  err,
  MAIN_SERVICE_CONTRACTS,
  connectRpc,
  type AsyncResult,
  type Clock,
  type Container,
  type EventBus,
  type ImportSink,
  type PortLike,
} from '@taalcut/core';
import {
  createAdbBridge,
  createDeviceService,
  createHelperEndpoint,
  createImageCaptureBridge,
  createMtpBridge,
  createWebUsbWatcher,
  DeviceBridgesToken,
  UsbWatcherToken,
  type AdbKeySource,
  type DeviceService,
  type HelperEndpoint,
  type TransferMedia,
} from '@taalcut/transfer';
import { createJsonLineSidecar, SidecarNotFound, SidecarPinMismatch } from '@taalcut/media';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { macHelperResolver } from './mac-helper-resolver';

/** A helper that prints no ready line in this time is killed and the connect fails. */
const HELPER_READY_MS = 15_000;

export const UsbUnavailable = defineError('desktop.usb_unavailable');
/** Cable import isn't on this OS yet (Linux, Windows): the window says so and offers Wi-Fi. */
export const CableUnsupported = defineError('desktop.cable_unsupported');

export interface LanDevicesDeps {
  readonly container: Container;
  readonly config: UtilityConfig;
  readonly main: PortLike | undefined;
  readonly importSink: ImportSink;
  readonly media: TransferMedia;
  readonly events: Pick<EventBus, 'emit'>;
  readonly clock: Clock;
  /** Keeps the real service alive for as long as the process container is. */
  readonly retain: (service: DeviceService) => void;
  /** This OS has cable import (PlatformAbilities.cableImport); without it the addon is never loaded. */
  readonly cableImport: boolean;
}

export function registerLanDevices(deps: LanDevicesDeps): DeviceService {
  let opening: Promise<DeviceService | undefined> | undefined;
  // A production dependency of the app (packaging: unpacked from the ASAR), external to the bundle.
  const usbLoaded = deps.cableImport
    ? import('usb').then(
        () => true,
        () => false,
      )
    : Promise.resolve(false);
  const unavailable = () => (deps.cableImport ? UsbUnavailable() : CableUnsupported());

  const ready = (): Promise<DeviceService | undefined> => {
    opening ??= usbLoaded.then((loaded) => {
      if (!loaded) return undefined;
      const service = createReal(deps);
      deps.retain(service);
      return service;
    });
    return opening;
  };

  /**
   * Every result procedure: the real service once `usb` has loaded, else `desktop.usb_unavailable` (or, off a Mac,
   * `desktop.cable_unsupported`).
   */
  const call = async <T>(use: (service: DeviceService) => AsyncResult<T>): AsyncResult<T> => {
    const service = await ready();
    return service ? use(service) : err(unavailable());
  };
  /** The two streams: the same, but an unavailable addon ends the stream with that error. */
  async function* stream<T>(use: (service: DeviceService) => AsyncIterable<T>): AsyncGenerator<T> {
    const service = await ready();
    if (!service) throw unavailable();
    yield* use(service);
  }

  const facade: DeviceService = {
    devices: (signal) => stream((service) => service.devices(signal)),
    deviceRun: (runId, signal) => stream((service) => service.deviceRun(runId, signal)),
    openDevice: (deviceKey, signal) => call((service) => service.openDevice(deviceKey, signal)),
    deviceItems: (input, signal) => call((service) => service.deviceItems(input, signal)),
    deviceSummary: (input, signal) => call((service) => service.deviceSummary(input, signal)),
    importFromDevice: (input, signal) => call((service) => service.importFromDevice(input, signal)),
    deviceRunItems: (input) =>
      call((service) =>
        service.deviceRunItems ? service.deviceRunItems(input) : Promise.resolve(err(unavailable())),
      ),
    pauseDeviceImport: (runId) => call((service) => service.pauseDeviceImport(runId)),
    resumeDeviceImport: (runId) => call((service) => service.resumeDeviceImport(runId)),
    cancelDeviceImport: (runId) => call((service) => service.cancelDeviceImport(runId)),
    forgetUsbDebugKey: () => call((service) => service.forgetUsbDebugKey()),
    // Only a service that was made has runs to stop; closing never loads the addon.
    close: async () => {
      const service = await opening?.catch(() => undefined);
      await service?.close();
    },
  };
  return facade;
}

/** Codes, device keys and upload ids only (transfer SPEC, Errors): never serials, names or paths. */
const usbLog = { info: (line: string) => console.warn(`[lan] ${line}`) };

function createReal(deps: LanDevicesDeps): DeviceService {
  const { keys, forgetAdbKey } = adbKeys(deps.main);
  const bridges = [
    createAdbBridge({ keys, log: usbLog }),
    createMtpBridge(),
    createImageCaptureBridge({
      connect: () => connectHelper(deps.importSink, deps.config),
      scratchDir: thumbsDir(deps.config),
    }),
  ];
  const watcher = createWebUsbWatcher();
  deps.container.value(DeviceBridgesToken, bridges);
  deps.container.value(UsbWatcherToken, watcher);
  return createDeviceService({
    bridges,
    watcher,
    importSink: deps.importSink,
    media: deps.media,
    events: deps.events,
    clock: deps.clock,
    stateDir: join(deps.config.userData, 'transfer'),
    forgetAdbKey,
    log: usbLog,
  });
}

/** The adb key lives in main's vault. Without a port, signing in rejects and forgetting is a no-op. */
function adbKeys(main: PortLike | undefined): {
  readonly keys: AdbKeySource;
  readonly forgetAdbKey: () => Promise<boolean>;
} {
  if (!main) {
    return {
      keys: { pkcs8: () => Promise.reject(new Error('adb-key')) },
      forgetAdbKey: () => Promise.resolve(false),
    };
  }
  const { client } = connectRpc(MAIN_SERVICE_CONTRACTS.lan, main, { peer: 'main' });
  return {
    keys: {
      async pkcs8() {
        const { pkcs8 } = await client.deviceKeys.adbKey();
        return Uint8Array.from(Buffer.from(pkcs8, 'base64'));
      },
    },
    async forgetAdbKey() {
      const result = await client.deviceKeys.forgetAdbKey();
      return result.forgotten;
    },
  };
}

/** The thumbnail cache (transfer's thumbs.ts) and the helper's scratch for thumbnails. */
function thumbsDir(config: UtilityConfig): string {
  return join(config.userData, 'transfer', 'usb', 'thumbs');
}

/** A helper code the image-capture bridge maps into its error's `detail` (devices.* or helper.*). */
class HelperConnectError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'HelperConnectError';
  }
}

/**
 * Starts the helper's `devices` service. It may write only into the import sink's staging folder
 * (where transfer stages each `.part` and its download folder) and the thumbs folder.
 */
async function connectHelper(sink: ImportSink, config: UtilityConfig): Promise<HelperEndpoint> {
  const place = await sink.staging();
  if (!place.ok) throw new HelperConnectError('helper.staging_unavailable');
  const thumbs = thumbsDir(config);
  await mkdir(place.value.dir, { recursive: true });
  await mkdir(thumbs, { recursive: true });
  const [stagingRoot, thumbsRoot] = await Promise.all([realpath(place.value.dir), realpath(thumbs)]);
  const found = await macHelperResolver(config).resolve();
  if (!found.ok) throw new HelperConnectError(resolveCode(found.error.code));
  const sidecar = createJsonLineSidecar({
    command: found.value.path,
    args: ['serve', '--services', 'devices', '--allow-root', stagingRoot, '--allow-root', thumbsRoot],
    readyTimeoutMs: HELPER_READY_MS,
  });
  return createHelperEndpoint(sidecar);
}

function resolveCode(code: string): string {
  if (code === SidecarNotFound.code) return 'helper.not_found';
  if (code === SidecarPinMismatch.code) return 'helper.pin_mismatch';
  return 'helper.unavailable';
}
