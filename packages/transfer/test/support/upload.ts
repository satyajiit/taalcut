// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { createHash } from 'node:crypto';
import { Upload } from 'tus-js-client';
import { fileFingerprint } from '../../src/names';
import { httpCall } from './harness';

export interface UploadTarget {
  readonly address: string;
  readonly port: number;
  base(): string;
}

export function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** A recognisable video: an `mp42` ftyp box, then a non-zero pattern. */
export function videoBytes(size: number): Buffer {
  const bytes = Buffer.allocUnsafe(size);
  const chunk = Buffer.alloc(64 * 1024);
  chunk.writeUInt32BE(20, 0);
  chunk.write('ftyp', 4);
  chunk.write('mp42', 8);
  for (let offset = 20; offset < chunk.length; offset += 1) chunk[offset] = offset & 0xff;
  for (let offset = 0; offset < size; offset += chunk.length) {
    chunk.copy(bytes, offset, 0, Math.min(chunk.length, size - offset));
  }
  return bytes;
}

export function jpegBytes(size = 128): Buffer {
  const bytes = Buffer.alloc(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  for (let offset = 3; offset < size; offset += 1) bytes[offset] = offset & 0xff;
  return bytes;
}

export async function pairPhone(
  fx: UploadTarget,
  body: { token?: string; code?: string; pin: string },
  userAgent = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
): Promise<{ status: number; body: string; credential: string; deviceId: string }> {
  const res = await httpCall({
    host: fx.address,
    port: fx.port,
    method: 'POST',
    path: '/api/pair',
    headers: { 'content-type': 'application/json', 'user-agent': userAgent },
    body: JSON.stringify({ ...body, device: { name: 'not-trusted' } }),
  });
  const parsed =
    res.body.length > 0 ? (JSON.parse(res.body) as { credential?: string; deviceId?: string }) : {};
  return {
    status: res.status,
    body: res.body,
    credential: parsed.credential ?? '',
    deviceId: parsed.deviceId ?? '',
  };
}

export function tokenOf(qrText: string): string {
  const hash = new URL(qrText).hash;
  return hash.startsWith('#k=') ? hash.slice(3) : '';
}

export interface UploadSpec {
  readonly fx: UploadTarget;
  readonly credential: string;
  readonly data: Buffer;
  readonly name: string;
  readonly chunkSize?: number;
  readonly uploadUrl?: string;
  readonly lastModified?: number;
  readonly type?: string;
  readonly onChunk?: (sent: number, total: number) => void;
  /** Abort without terminating once the server has accepted this many bytes. */
  readonly abortAfter?: number;
}

export function beginUpload(spec: UploadSpec): {
  upload: Upload;
  done: Promise<void>;
  paused: Promise<void>;
} {
  const type = spec.type ?? 'video/quicktime';
  const lastModified = spec.lastModified ?? 1_700_000_000_000;
  const upload = new Upload(spec.data, {
    endpoint: `${spec.fx.base()}/files`,
    uploadUrl: spec.uploadUrl ?? null,
    uploadSize: spec.data.length,
    chunkSize: spec.chunkSize ?? 1024 * 1024,
    retryDelays: [],
    headers: { Authorization: `Bearer ${spec.credential}` },
    metadata: {
      filename: spec.name,
      filetype: type,
      lastModified: String(lastModified),
      fingerprint: fileFingerprint({ name: spec.name, size: spec.data.length, lastModified, type }),
    },
    onChunkComplete(_size, sent, total) {
      spec.onChunk?.(sent, total);
      if (spec.abortAfter !== undefined && sent >= spec.abortAfter) {
        void upload.abort(false).then(resolvePaused, rejectPaused);
      }
    },
  });
  let resolvePaused: () => void = () => undefined;
  let rejectPaused: (error: Error) => void = () => undefined;
  const paused = new Promise<void>((resolve, reject) => {
    resolvePaused = resolve;
    rejectPaused = reject;
  });
  const done = new Promise<void>((resolve, reject) => {
    upload.options.onSuccess = () => resolve();
    upload.options.onError = (error) => reject(error instanceof Error ? error : new Error(String(error)));
  });
  if (spec.abortAfter !== undefined) void done.catch(() => undefined);
  upload.start();
  return { upload, done, paused };
}

export async function uploadAll(spec: UploadSpec): Promise<string> {
  const { upload, done } = beginUpload(spec);
  await done;
  if (!upload.url) throw new Error('tus upload finished without a url');
  return upload.url;
}
