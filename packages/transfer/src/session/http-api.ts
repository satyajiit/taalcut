// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import type { HttpHost, HttpResult } from '../http/dispatch';
import { TRANSFER_LIMITS } from '../limits';
import { fileFingerprint } from '../names';
import { safeEqual } from '../pairing/secrets';
import { fileSize, type UploadRecord } from '../store/uploads';
import { admit, grantBody, grantDevice, json, limited, listening, notePairFailure } from './admission';
import { askApproval, cancelApproval, waitApproval } from './approvals';
import type { SessionBox } from './box';
import type { LiveFile } from './live';

const RESUME = new Set(['uploading', 'paused']);

export function createHost(box: SessionBox): HttpHost {
  return {
    get address() {
      return box.current?.address ?? '';
    },
    get port() {
      return box.current?.port ?? 0;
    },
    get assets() {
      return box.deps.phoneAssets;
    },
    get tus() {
      return box.current?.tus ?? null;
    },
    allowPublic: (ip) => allowPublic(box, ip),
    pair: (ip, userAgent, body) => pair(box, ip, userAgent, body),
    askApproval: (ip, userAgent, body) => askApproval(box, ip, userAgent, body),
    waitApproval: (ip, body) => waitApproval(box, ip, body),
    cancelApproval: (ip, body) => cancelApproval(box, ip, body),
    authorise: (ip, credential, method) => authorise(box, ip, credential, method),
    lookup: (deviceId, body) => lookup(box, deviceId, body),
    session: (deviceId) => sessionView(box, deviceId),
    touchIdle: () => touchIdle(box),
  };
}

function allowPublic(box: SessionBox, ip: string): HttpResult | null {
  return limited(box, `unauth:${ip}`, TRANSFER_LIMITS.unauthPerMinute, 60_000);
}

function touchIdle(box: SessionBox): void {
  const session = box.current;
  if (!session || session.state !== 'listening') return;
  box.armIdle(session);
}

async function pair(box: SessionBox, ip: string, userAgent: string, body: unknown): Promise<HttpResult> {
  const session = listening(box);
  if (!session) return { status: 404 };
  const paced = limited(box, `pair:${ip}`, TRANSFER_LIMITS.pairPerSecond, 1_000);
  if (paced) return paced;
  const secrets = pairSecrets(body);
  if (!secrets) return { status: 401 };
  const tokenOk = secrets.token.length > 0 && safeEqual(secrets.token, session.secrets.token);
  const codeOk = secrets.code.length > 0 && safeEqual(secrets.code, session.secrets.code);
  const pinOk = safeEqual(secrets.pin, session.secrets.pin);
  const matched = pinOk && (secrets.token.length > 0 ? tokenOk : codeOk);
  if (!matched) {
    notePairFailure(box, session);
    return { status: 401 };
  }
  if (session.devices.size >= TRANSFER_LIMITS.maxDevices) return { status: 403 };
  return json(200, grantBody(await grantDevice(box, session, userAgent)));
}

async function authorise(
  box: SessionBox,
  ip: string,
  credential: string | null,
  method: string,
): Promise<
  { readonly ok: true; readonly deviceId: string } | { readonly ok: false; readonly result: HttpResult }
> {
  const session = listening(box);
  if (!session) return { ok: false, result: { status: 404 } };
  if (!credential) return { ok: false, result: allowPublic(box, ip) ?? { status: 401 } };
  const stored = box.devices.find(credential, box.deps.clock.now());
  if (!stored) return { ok: false, result: allowPublic(box, ip) ?? { status: 401 } };
  if (method !== 'PATCH') {
    const paced = limited(box, `api:${stored.id}`, TRANSFER_LIMITS.apiPerMinute, 60_000);
    if (paced) return { ok: false, result: paced };
  }
  const now = box.deps.clock.now();
  box.devices.touch(stored.id, now);
  const admitted = admit(box, session, stored);
  if (admitted) return { ok: false, result: admitted };
  return { ok: true, deviceId: stored.id };
}

function sessionView(box: SessionBox, deviceId: string): HttpResult {
  const session = listening(box);
  if (!session) return { status: 404 };
  const files = [...session.files.values()]
    .filter((file) => file.deviceId === deviceId)
    .map((file) => ({
      id: file.id,
      name: file.name,
      sizeBytes: file.sizeBytes,
      receivedBytes: file.receivedBytes,
      state: file.state,
      ...(file.reencode ? { reencode: file.reencode } : {}),
      ...(file.error ? { error: publicError(file) } : {}),
    }));
  return json(200, {
    accepting: true,
    ...(session.idleStopAt > 0 ? { idleStopAt: session.idleStopAt } : {}),
    files,
  });
}

async function lookup(box: SessionBox, deviceId: string, body: unknown): Promise<HttpResult> {
  const session = listening(box);
  if (!session) return { status: 404 };
  const files = listedFiles(body);
  if (!files) return { status: 400 };
  const mine = box.uploads.all().filter((record) => record.deviceId === deviceId);
  const matches = [];
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index];
    if (!file) continue;
    const fingerprint = fileFingerprint(file);
    const record = pickRecord(mine.filter((item) => item.fingerprint === fingerprint));
    if (!record) continue;
    const onDisk = await fileSize(join(session.stagingDir, record.id));
    const state = lookupState(box, record, onDisk);
    if (!state) continue;
    const live = session.files.get(record.id);
    const offset = onDisk ?? (state === 'uploading' || state === 'paused' ? 0 : record.sizeBytes);
    matches.push({
      index,
      uploadId: record.id,
      offset,
      state,
      ...(live?.reencode ? { reencode: live.reencode } : {}),
    });
  }
  return json(200, { matches });
}

function listedFiles(
  body: unknown,
): Array<{ name: string; size: number; lastModified: number | null; type: string }> | null {
  if (!body || typeof body !== 'object') return null;
  const files = (body as { files?: unknown }).files;
  if (!Array.isArray(files) || files.length > TRANSFER_LIMITS.lookupMaxFiles) return null;
  const out = [];
  for (const item of files) {
    if (!item || typeof item !== 'object') return null;
    const record = item as Record<string, unknown>;
    if (typeof record.name !== 'string' || typeof record.size !== 'number' || !Number.isFinite(record.size)) {
      return null;
    }
    out.push({
      name: record.name,
      size: record.size,
      lastModified: typeof record.lastModified === 'number' ? record.lastModified : null,
      type: typeof record.type === 'string' ? record.type : '',
    });
  }
  return out;
}

function pickRecord(records: UploadRecord[]): UploadRecord | null {
  const open = records.filter((record) => !record.finishedAt && RESUME.has(record.state));
  const pool = open.length > 0 ? open : records.filter((record) => record.finishedAt !== null);
  pool.sort((left, right) => (right.finishedAt ?? right.createdAt) - (left.finishedAt ?? left.createdAt));
  return pool[0] ?? null;
}

function lookupState(box: SessionBox, record: UploadRecord, onDisk: number | null): string | null {
  if (record.state === 'cancelled' || record.state === 'rejected') return null;
  if (record.state === 'imported' || record.state === 'duplicate') {
    if (record.finishedAt && box.deps.clock.now() - record.finishedAt > TRANSFER_LIMITS.partialTtlMs)
      return null;
    return record.state;
  }
  const complete =
    record.finishedAt !== null || (onDisk !== null && record.sizeBytes > 0 && onDisk >= record.sizeBytes);
  if (complete) {
    if (record.finishedAt && box.deps.clock.now() - record.finishedAt > TRANSFER_LIMITS.partialTtlMs)
      return null;
    return 'received';
  }
  if (onDisk === null) return null;
  return record.state === 'paused' ? 'paused' : 'uploading';
}

function pairSecrets(body: unknown): { token: string; code: string; pin: string } | null {
  if (!body || typeof body !== 'object') return null;
  const record = body as Record<string, unknown>;
  const pin = typeof record.pin === 'string' ? record.pin : '';
  const token = typeof record.token === 'string' ? record.token : '';
  const code = typeof record.code === 'string' ? record.code : '';
  if (!/^\d{6}$/.test(pin) || (token.length === 0 && code.length === 0)) return null;
  return { token, code, pin };
}

function publicError(file: LiveFile): { code: string; messageKey: string; retryable: boolean } {
  return {
    code: file.error?.code ?? 'transfer.import_failed',
    messageKey: file.error?.messageKey ?? 'errors.transfer.import_failed',
    retryable: file.error?.retryable ?? false,
  };
}
