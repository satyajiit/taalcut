// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// What both ways of pairing share (the PIN, and a person's Allow on the computer): letting a phone in, and the
// small answers the phone API gives.
import { newId, type TransferDeviceId } from '@taalcut/core';
import type { TransferPlatform } from '../deps';
import type { HttpResult } from '../http/dispatch';
import { TRANSFER_LIMITS } from '../limits';
import { sha256, type StoredDevice } from '../pairing/devices';
import { describeDevice, mintCredential } from '../pairing/secrets';
import type { SessionBox } from './box';
import type { LiveSession } from './live';
import { rotateSecrets } from './machine';

/** What a phone gets once it is paired: its id, the bearer credential (only ever sent here) and the limits. */
export interface Grant {
  readonly deviceId: TransferDeviceId;
  readonly credential: string;
}

/** A new paired phone: a credential minted, its hash stored, the phone shown in the session. */
export async function grantDevice(box: SessionBox, session: LiveSession, userAgent: string): Promise<Grant> {
  const credential = mintCredential(box.random);
  const described = describeDevice(userAgent);
  const now = box.deps.clock.now();
  const device: StoredDevice = {
    id: newId<'TransferDevice'>(),
    hash: sha256(credential),
    label: described.label,
    platform: described.platform,
    userAgent: userAgent.slice(0, 400),
    connectedAt: now,
    lastSeenAt: now,
  };
  await box.devices.add(device);
  admit(box, session, device);
  return { deviceId: device.id, credential };
}

/** The body of a successful pairing, by PIN or by approval. */
export function grantBody(grant: Grant): Record<string, unknown> {
  return {
    deviceId: grant.deviceId,
    credential: grant.credential,
    limits: {
      chunkSize: TRANSFER_LIMITS.chunkSize,
      parallel: TRANSFER_LIMITS.parallelPerDevice,
      maxFileBytes: TRANSFER_LIMITS.maxFileBytes,
    },
  };
}

/** Shows a paired phone in the session; 403 once it holds as many phones as it may. */
export function admit(box: SessionBox, session: LiveSession, stored: StoredDevice): HttpResult | null {
  const now = box.deps.clock.now();
  const existing = session.devices.get(stored.id);
  if (existing) {
    existing.lastSeenAt = now;
    return null;
  }
  if (session.devices.size >= TRANSFER_LIMITS.maxDevices) return { status: 403 };
  session.devices.set(stored.id, {
    id: stored.id,
    label: stored.label,
    platform: platformOf(stored.platform),
    userAgent: stored.userAgent ?? '',
    connectedAt: stored.connectedAt || now,
    lastSeenAt: now,
  });
  box.emitSession(session, false);
  return null;
}

export function listening(box: SessionBox): LiveSession | null {
  const session = box.current;
  if (!session || session.state !== 'listening') return null;
  return session;
}

/** Null while under `limit` hits per `windowMs` for `key`, else a 429 with Retry-After. */
export function limited(box: SessionBox, key: string, limit: number, windowMs: number): HttpResult | null {
  const hit = box.rates.hit(key, limit, windowMs);
  if (hit.ok) return null;
  return { status: 429, retryAfter: hit.retryAfter };
}

export function json(status: number, value: unknown): HttpResult {
  return { status, body: JSON.stringify(value), type: 'application/json' };
}

/** A failed pairing attempt: five in a session replace the token, code and PIN, and the screen warns. */
export function notePairFailure(box: SessionBox, session: LiveSession): void {
  session.pairFailures += 1;
  box.log('pair rejected');
  if (session.pairFailures < TRANSFER_LIMITS.pairFailuresBeforeReset) return;
  rotateSecrets(session, box.random);
  box.emitSession(session, true);
  box.log(`pair reset ${session.pairingResets}`);
}

function platformOf(value: string): TransferPlatform {
  if (value === 'ios' || value === 'android' || value === 'other') return value;
  return 'other';
}
