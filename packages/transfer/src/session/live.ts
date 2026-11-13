// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { Server as HttpServer } from 'node:http';
import type { Server as TusServer } from '@tus/server';
import type { FileStore } from '@tus/file-store';
import type {
  AssetId,
  PublicError,
  ReencodeCheck,
  TransferApproval,
  TransferApprovalId,
  TransferDeviceId,
  TransferFile,
  TransferPairing,
  TransferSession,
  TransferSessionId,
  TransferStreamItem,
  TransferUploadId,
} from '@taalcut/core';
import type { PairingSecrets } from '../pairing/secrets';
import type { TransferPlatform } from '../deps';
import type { ItemQueue } from './queue';
import { qrText, sessionUrl } from '../pairing/secrets';

export type FileState = TransferFile['state'];
export type StopReason = NonNullable<TransferSession['stopReason']>;

export interface LiveFile {
  id: TransferUploadId;
  sessionId: TransferSessionId;
  deviceId: TransferDeviceId;
  name: string;
  ext: string;
  sizeBytes: number;
  receivedBytes: number;
  spaceReserved?: boolean;
  spaceReservation?: Promise<void>;
  spaceOffset?: number;
  state: FileState;
  fingerprint: string;
  lastModified: number | null;
  mime: string | null;
  createdAt: number;
  updatedAt: number;
  /** Last progress event. State changes emit immediately; byte updates wait 250 ms. */
  lastEmitAt: number;
  receivedAt: number | null;
  sniffed: boolean;
  attempts: number;
  userAgent: string;
  bytesPerSecond?: number;
  etaMs?: number;
  reencode?: ReencodeCheck;
  assetId?: AssetId;
  error?: PublicError;
}

export interface LiveDevice {
  id: TransferDeviceId;
  label: string;
  platform: TransferPlatform;
  userAgent: string;
  connectedAt: number;
  lastSeenAt: number;
}

/** A phone's request to pair, from the QR's token, until a person answers it on the computer (UX3). */
export interface LiveApproval {
  id: TransferApprovalId;
  /** SHA-256 of the ticket the phone polls with; the ticket itself is never kept. */
  ticketHash: string;
  state: TransferApproval['state'];
  label: string;
  platform: TransferPlatform;
  userAgent: string;
  address: string;
  matchCode: string;
  requestedAt: number;
  expiresAt: number;
  lastPolledAt: number;
  /** Set by Allow until the phone collects it: the only place the credential is held. */
  grant: { deviceId: TransferDeviceId; credential: string } | null;
  /** The phone has been told how it ended; its ticket is spent. */
  told: boolean;
  timer: ReturnType<typeof setInterval> | null;
}

export interface LiveSession {
  readonly requests: Set<Promise<void>>;
  stopping?: Promise<void>;
  releaseDestination?: () => void;
  id: TransferSessionId;
  state: TransferSession['state'];
  stopReason?: StopReason;
  iface: string;
  address: string;
  port: number;
  secrets: PairingSecrets;
  pairingResets: number;
  pairFailures: number;
  startedAt: number;
  idleStopAt: number;
  reachable: 'yes' | 'blocked' | 'local-network-denied' | 'unknown';
  stagingDir: string;
  volumeName: string | null;
  devices: Map<string, LiveDevice>;
  /** Requests to pair by id, the pending one and the last few settled (UX3). */
  approvals: Map<string, LiveApproval>;
  files: Map<string, LiveFile>;
  queue: ItemQueue<TransferStreamItem>;
  http: HttpServer | null;
  tus: TusServer | null;
  store: FileStore | null;
  unwatch: (() => void) | null;
  idleTimer: ReturnType<typeof setTimeout> | null;
}

export function toSession(live: LiveSession): TransferSession {
  let files = 0;
  let done = 0;
  let failed = 0;
  let bytes = 0;
  let bytesDone = 0;
  for (const file of live.files.values()) {
    files += 1;
    bytes += file.sizeBytes;
    bytesDone += file.receivedBytes;
    if (file.state === 'imported' || file.state === 'duplicate') done += 1;
    if (file.state === 'failed' || file.state === 'rejected') failed += 1;
  }
  const listening = live.address.length > 0 && live.port > 0;
  return {
    id: live.id,
    state: live.state,
    ...(live.stopReason ? { stopReason: live.stopReason } : {}),
    ...(listening ? { url: sessionUrl(live.address, live.port) } : {}),
    ...(listening
      ? {
          network: { interface: live.iface, address: live.address, reachable: live.reachable },
        }
      : {}),
    ...(live.state === 'listening' && live.idleStopAt > 0 ? { idleStopAt: live.idleStopAt } : {}),
    pairingResets: live.pairingResets,
    devices: [...live.devices.values()].map((device) => ({
      id: device.id,
      label: device.label,
      platform: device.platform,
      connectedAt: device.connectedAt,
      lastSeenAt: device.lastSeenAt,
    })),
    totals: { files, done, failed, bytes, bytesDone },
    startedAt: live.startedAt,
  };
}

export function toPairing(live: LiveSession): TransferPairing {
  const url = sessionUrl(live.address, live.port);
  return { qrText: qrText(url, live.secrets.token), code: live.secrets.code, pin: live.secrets.pin };
}

export function toFile(file: LiveFile): TransferFile {
  return {
    id: file.id,
    sessionId: file.sessionId,
    deviceId: file.deviceId,
    name: file.name,
    sizeBytes: file.sizeBytes,
    receivedBytes: file.receivedBytes,
    state: file.state,
    ...(file.bytesPerSecond !== undefined ? { bytesPerSecond: file.bytesPerSecond } : {}),
    ...(file.etaMs !== undefined ? { etaMs: file.etaMs } : {}),
    ...(file.reencode ? { reencode: file.reencode } : {}),
    ...(file.assetId ? { assetId: file.assetId } : {}),
    ...(file.error ? { error: file.error } : {}),
    updatedAt: file.updatedAt,
  };
}

export function toApproval(session: LiveSession, approval: LiveApproval): TransferApproval {
  return {
    id: approval.id,
    sessionId: session.id,
    state: approval.state,
    device: { label: approval.label, platform: approval.platform },
    address: approval.address,
    matchCode: approval.matchCode,
    requestedAt: approval.requestedAt,
    expiresAt: approval.expiresAt,
  };
}
