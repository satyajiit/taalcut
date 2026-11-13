// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { open } from 'node:fs/promises';
import type { Upload } from '@tus/server';
import { fileExtension, sanitiseFileName, sniffMediaType } from '../names';
import { TRANSFER_LIMITS } from '../limits';
import { tusError } from './mount';

export interface ParsedUpload {
  readonly name: string;
  readonly ext: string;
  readonly mime: string | null;
  readonly lastModified: number | null;
  readonly fingerprint: string;
  readonly sizeBytes: number;
}

/** Creation rules that run before the empty file is written. */
export function parseCreation(upload: Upload, rawMetadata: string): ParsedUpload {
  if (upload.size === undefined || upload.sizeIsDeferred) throw tusError(400, 'length_required');
  if (rawMetadata.length > TRANSFER_LIMITS.maxMetadataBytes) throw tusError(413, 'too_large');
  const metadata = upload.metadata ?? {};
  const filename = text(metadata, 'filename');
  const filetype = text(metadata, 'filetype');
  const lastModifiedText = text(metadata, 'lastModified');
  const fingerprint = text(metadata, 'fingerprint');
  if (!filename || filetype === null || lastModifiedText === null || !fingerprint) throw tusError(400, 'metadata');
  const name = sanitiseFileName(filename);
  const lastModified = Number(lastModifiedText);
  return {
    name,
    ext: fileExtension(name),
    mime: filetype.length > 0 ? filetype.slice(0, 100) : null,
    lastModified: Number.isFinite(lastModified) && lastModified >= 0 ? Math.trunc(lastModified) : null,
    fingerprint,
    sizeBytes: upload.size,
  };
}

function text(metadata: Record<string, string | null>, key: string): string | null {
  const value = metadata[key];
  return typeof value === 'string' ? value : null;
}

export function assertRoom(input: {
  readonly files: number;
  readonly concurrent: number;
  readonly free: number;
  readonly size: number;
  readonly unfinished: number;
}): void {
  if (input.files >= TRANSFER_LIMITS.maxFilesPerSession) throw tusError(429, 'too_many_files');
  if (input.concurrent >= TRANSFER_LIMITS.concurrentPerDevice) throw tusError(429, 'too_many_uploads');
  const need = input.size + TRANSFER_LIMITS.reserveBytes + input.unfinished;
  if (need > input.free) throw tusError(507, 'disk_full');
}

/**
 * `wait` until 64 KiB are on disk, unless the whole file is shorter than that.
 * `declared` is Upload-Length. `available` is the bytes already in the staging file.
 */
export async function sniffStaged(
  path: string,
  declared: number,
  available: number,
): Promise<'ok' | 'wait' | 'reject'> {
  if (available <= 0) return 'wait';
  if (available < TRANSFER_LIMITS.sniffBytes && declared > available) return 'wait';
  const have = Math.min(available, declared, TRANSFER_LIMITS.sniffBytes);
  if (have <= 0) return 'wait';
  const handle = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(have);
    await handle.read(bytes, 0, have, 0);
    return sniffMediaType(bytes) === null ? 'reject' : 'ok';
  } finally {
    await handle.close();
  }
}
