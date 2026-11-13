// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * @taalcut/transfer: LAN server, pairing, resumable uploads, USB device bridges.
 *
 * This file is the package's only public entry point. Other packages import
 * from '@taalcut/transfer' and never from a path inside src/.
 */
export { createTransferService, type TransferService } from './service';
export { transferRouter } from './router';
export { phoneAssetsFromDir, type PhoneMachine } from './phone-assets';
export type { PhoneAsset, PhoneAssets, Reachable, TransferDeps, TransferMedia } from './deps';
export {
  isBindableAddress,
  isLanAddress,
  isLoopbackAddress,
  nodeNetworkInfo,
  selectCandidates,
  type LanInterface,
  type NetworkInfo,
} from './network';
export { checkReencode, type ReencodeInput, type ReencodeProbe } from './reencode';
export { fileExtension, fileFingerprint, sanitiseFileName, sniffMediaType } from './names';
export { TRANSFER_LIMITS } from './limits';
export {
  BindFailed,
  DiskFull,
  ImportFailed,
  NoNetwork,
  NotMedia,
  PairingFailed,
  SessionClosed,
  TooLarge,
} from './errors';
export type { TransferPlatform } from './deps';
export {
  ImportSinkToken,
  REENCODE_SIGNALS,
  REENCODE_VERDICTS,
  reencodeCheckSchema,
  stagedImportSchema,
  TRANSFER_FILE_STATES,
  TRANSFER_PLATFORMS,
  TRANSFER_SESSION_STATES,
  TRANSFER_STOP_REASONS,
  transferContract,
  transferDeviceSchema,
  transferFileSchema,
  transferPairingSchema,
  transferSessionSchema,
  transferStreamItemSchema,
  type ImportOutcome,
  type ImportSink,
  type ReencodeCheck,
  type StagedImport,
  type TransferDevice,
  type TransferDeviceId,
  type TransferFile,
  type TransferPairing,
  type TransferSession,
  type TransferSessionId,
  type TransferStreamItem,
  type TransferUploadId,
} from '@taalcut/core';
export type { ReencodeSignal, ReencodeVerdict } from './reencode';
export type {
  BridgeDeviceRef,
  BridgeKind,
  BridgeSession,
  DeviceAccess,
  DeviceBridge,
  DeviceItem,
  DeviceItemFlags,
  DeviceItemsPage,
  DeviceService,
  DeviceSummary,
  DeviceViewItem,
  PullOptions,
  PullResult,
  UsbDeviceInfo,
  UsbWatcher,
} from './usb/bridge';
export { DeviceBridgesToken, UsbWatcherToken } from './usb/bridge';
export { deviceKey, itemKey } from './usb/device-key';
export {
  BridgeFailed,
  DeviceBusy,
  DeviceGone,
  DeviceLocked,
  DeviceUnsupported,
  HashMismatch,
  RunInProgress,
  ShortRead,
  TooManyItems,
} from './usb/errors';
export { createImageCaptureBridge, type ImageCaptureBridgeOptions } from './bridges/image-capture/bridge';
export { createHelperEndpoint, type HelperEndpoint, type HelperEvent } from './bridges/image-capture/client';
export { createDeviceHub, type DeviceHub, type DeviceHubDeps } from './usb/hub';
export { createDeviceService, type DeviceServiceDeps } from './usb/usb-service';
export { createWebUsbWatcher } from './usb-watch/webusb-watch';
export { createAdbBridge, type AdbBridgeOptions } from './bridges/adb/bridge';
export { createAdbCredentialStore, type AdbKeySource } from './bridges/adb/credentials';
export { createMtpBridge, type MtpBridgeOptions } from './bridges/mtp/bridge';
export type { MtpPipe } from './bridges/mtp/session';
