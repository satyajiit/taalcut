// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { join } from 'node:path';
import { isId, type StagedImport, type TransferDeviceId, type TransferUploadId } from '@taalcut/core';
import type { Upload } from '@tus/server';
import type { TransferPlatform } from '../deps';
import { NotMedia } from '../errors';
import { writeImportJournal } from '../handoff/journal';
import { requestDevice } from '../http/context';
import { fileExtension } from '../names';
import { fileSize, type UploadRecord } from '../store/uploads';
import { tusError, type TusCallbacks } from '../tus/mount';
import { assertRoom, parseCreation, sniffStaged } from '../tus/policy';
import type { SessionBox } from './box';
import { consumeUploadSpace, releaseUploadSpace, reserveUploadSpace } from './space';
import type { LiveFile, LiveSession } from './live';

const TERMINAL = new Set([
  'imported',
  'duplicate',
  'checking',
  'importing',
  'failed',
  'rejected',
  'cancelled',
]);

export function tusCallbacks(box: SessionBox): TusCallbacks {
  return {
    onCreate: (upload, raw) => onCreate(box, upload, raw),
    onReceive: (id, offset) => onReceive(box, id, offset),
    onFinish: (upload) => onFinish(box, upload),
    onIncoming: (method, uploadId) => onIncoming(box, method, uploadId),
  };
}

export function toRecord(file: LiveFile, finishedAt: number | null): UploadRecord {
  return {
    id: file.id,
    deviceId: file.deviceId,
    sessionId: file.sessionId,
    fingerprint: file.fingerprint,
    name: file.name,
    sizeBytes: file.sizeBytes,
    lastModified: file.lastModified,
    mime: file.mime,
    createdAt: file.createdAt,
    finishedAt,
    state: file.state,
  };
}

async function onCreate(box: SessionBox, upload: Upload, rawMetadata: string): Promise<void> {
  const session = live(box);
  const deviceId = requestDevice.getStore()?.deviceId;
  if (!session || !deviceId) throw tusError(401, '');
  const parsed = parseCreation(upload, rawMetadata);
  const id = upload.id;
  if (!id || !isId(id)) throw tusError(400, 'metadata');
  const mine = [...session.files.values()].filter((file) => file.deviceId === deviceId);
  const concurrent = mine.filter((file) => file.state === 'uploading').length;
  let unfinished = 0;
  for (const file of mine) {
    if (file.state === 'uploading') unfinished += Math.max(0, file.sizeBytes - file.receivedBytes);
  }
  const free = await box.diskFree(session.stagingDir);
  assertRoom({
    files: session.files.size,
    concurrent,
    free,
    size: parsed.sizeBytes,
    unfinished: box.deps.importSink.space ? 0 : unfinished,
  });
  const now = box.deps.clock.now();
  const device = session.devices.get(deviceId);
  const file: LiveFile = {
    id: id as TransferUploadId,
    sessionId: session.id,
    deviceId: deviceId as TransferDeviceId,
    name: parsed.name,
    ext: parsed.ext,
    sizeBytes: parsed.sizeBytes,
    receivedBytes: 0,
    state: 'uploading',
    fingerprint: parsed.fingerprint,
    lastModified: parsed.lastModified,
    mime: parsed.mime,
    createdAt: now,
    updatedAt: now,
    lastEmitAt: 0,
    receivedAt: null,
    sniffed: false,
    attempts: 0,
    userAgent: device?.userAgent ?? '',
  };
  await reserveUploadSpace(box, file);
  session.files.set(file.id, file);
  await box.uploads.save(toRecord(file, null));
  box.emitFile(file, true);
  box.log(`upload ${file.id} ${file.ext} ${file.sizeBytes}`);
}

function onReceive(box: SessionBox, id: string, offset: number): void {
  const session = box.current;
  const file = session?.files.get(id);
  if (!session || !file || file.state !== 'uploading') return;
  consumeUploadSpace(box, file, offset);
  file.receivedBytes = offset;
  const elapsed = Math.max(1, box.deps.clock.now() - file.createdAt);
  file.bytesPerSecond = Math.round((offset * 1000) / elapsed);
  const left = Math.max(0, file.sizeBytes - offset);
  file.etaMs = file.bytesPerSecond > 0 ? Math.round((left * 1000) / file.bytesPerSecond) : 0;
  box.armIdle(session);
  box.emitFile(file, false);
}

async function onIncoming(box: SessionBox, method: string, uploadId: string): Promise<void> {
  const session = live(box);
  const deviceId = requestDevice.getStore()?.deviceId;
  if (!session || !deviceId) throw tusError(401, '');
  if (method === 'POST') {
    if (uploadId && ownerOf(box, uploadId)) throw tusError(409, 'exists');
    return;
  }
  if (!uploadId || !isId(uploadId)) throw tusError(404, '');
  const owner = ownerOf(box, uploadId);
  if (!owner || owner !== deviceId) throw tusError(404, '');
  const file = session.files.get(uploadId) ?? hydrate(box, uploadId, deviceId);
  if (method === 'DELETE') {
    if (file && TERMINAL.has(file.state)) throw tusError(404, '');
    if (file) await markCancelled(box, file);
    return;
  }
  if (file && method === 'PATCH') await reserveUploadSpace(box, file);
  if (!file || file.sniffed || method !== 'PATCH') return;
  await sniffOrReject(box, file);
}

async function onFinish(box: SessionBox, upload: Upload): Promise<void> {
  const session = live(box);
  const id = upload.id;
  if (!session || !id) throw tusError(404, '');
  const file = session.files.get(id);
  if (!file) throw tusError(404, '');
  const path = join(session.stagingDir, file.id);
  const onDisk = await fileSize(path);
  if (onDisk === null || onDisk !== file.sizeBytes) throw tusError(409, 'size');
  if (!file.sniffed) {
    const verdict = await sniffStaged(path, file.sizeBytes, onDisk);
    if (verdict !== 'ok') {
      await rejectFile(box, file);
      throw tusError(415, 'not_media');
    }
    file.sniffed = true;
  }
  const now = box.deps.clock.now();
  consumeUploadSpace(box, file, file.sizeBytes);
  releaseUploadSpace(box, file);
  file.receivedBytes = file.sizeBytes;
  file.receivedAt = now;
  await writeImportJournal(session.stagingDir, initialJournal(box, file, session.stagingDir));
  await box.uploads.save(toRecord(file, now));
  box.handoff.enqueue(file, session.stagingDir);
  box.log(`received ${file.id} ${file.ext} ${file.sizeBytes}`);
}

function live(box: SessionBox): LiveSession | null {
  const session = box.current;
  if (!session || session.stopReason || session.state === 'stopped') return null;
  return session;
}

function ownerOf(box: SessionBox, id: string): string | null {
  return box.current?.files.get(id)?.deviceId ?? box.uploads.get(id)?.deviceId ?? null;
}

function hydrate(box: SessionBox, id: string, deviceId: string): LiveFile | null {
  const session = box.current;
  const record = box.uploads.get(id);
  if (!session || !record || record.deviceId !== deviceId || record.finishedAt) return null;
  const now = box.deps.clock.now();
  const device = session.devices.get(deviceId);
  const file: LiveFile = {
    id: record.id,
    sessionId: session.id,
    deviceId: record.deviceId,
    name: record.name,
    ext: fileExtension(record.name),
    sizeBytes: record.sizeBytes,
    receivedBytes: 0,
    state: 'uploading',
    fingerprint: record.fingerprint,
    lastModified: record.lastModified,
    mime: record.mime,
    createdAt: record.createdAt,
    updatedAt: now,
    lastEmitAt: 0,
    receivedAt: null,
    sniffed: false,
    attempts: 0,
    userAgent: device?.userAgent ?? '',
  };
  session.files.set(file.id, file);
  return file;
}

async function sniffOrReject(box: SessionBox, file: LiveFile): Promise<void> {
  const session = box.current;
  if (!session) return;
  const path = join(session.stagingDir, file.id);
  const onDisk = await fileSize(path);
  if (onDisk === null) return;
  const verdict = await sniffStaged(path, file.sizeBytes, onDisk);
  if (verdict === 'wait') return;
  file.sniffed = verdict === 'ok';
  if (verdict === 'reject') {
    await rejectFile(box, file);
    throw tusError(415, 'not_media');
  }
}

async function rejectFile(box: SessionBox, file: LiveFile): Promise<void> {
  const session = box.current;
  releaseUploadSpace(box, file);
  file.state = 'rejected';
  file.error = NotMedia();
  file.sniffed = true;
  await session?.store?.remove(file.id).catch(() => undefined);
  await box.uploads.save(toRecord(file, box.deps.clock.now()));
  box.emitFile(file, true);
  box.log(`reject ${file.id} ${file.ext} ${file.sizeBytes}`);
}

async function markCancelled(box: SessionBox, file: LiveFile): Promise<void> {
  releaseUploadSpace(box, file);
  file.state = 'cancelled';
  await box.uploads.save(toRecord(file, box.deps.clock.now()));
  box.emitFile(file, true);
  box.log(`cancel ${file.id} ${file.ext} ${file.sizeBytes}`);
}

function initialJournal(box: SessionBox, file: LiveFile, dir: string): StagedImport {
  const device = box.current?.devices.get(file.deviceId);
  const platform: TransferPlatform = device?.platform ?? 'other';
  return {
    sessionId: file.sessionId,
    uploadId: file.id,
    path: join(dir, file.id),
    companions: [join(dir, `${file.id}.json`)],
    fileName: file.name,
    sizeBytes: file.sizeBytes,
    mimeType: file.mime,
    lastModified: file.lastModified,
    device: { id: file.deviceId, label: device?.label ?? 'Phone', platform },
    reencode: { verdict: 'unknown', reasons: [] },
    receivedAt: file.receivedAt ?? box.deps.clock.now(),
    channel: 'wifi',
  };
}
