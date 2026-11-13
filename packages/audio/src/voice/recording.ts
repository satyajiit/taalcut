// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Facts of a consent recording main wrote (16-bit PCM WAV, voiceCaptureContract): its sha256, which ties a clone
 * to the consent, and its length from the WAV header. Anything that isn't such a WAV is refused.
 */
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { CloneSourceRefused } from './errors';

export interface RecordingFacts {
  readonly sha256: string;
  readonly durationMs: number;
}

/** Duration from a RIFF/WAVE header: the data chunk's bytes over the format's byte rate. */
export function wavDurationMs(bytes: Buffer): number | null {
  if (
    bytes.length < 12 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.toString('ascii', 8, 12) !== 'WAVE'
  )
    return null;
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (id === 'fmt ' && offset + 16 <= bytes.length) byteRate = bytes.readUInt32LE(offset + 16);
    if (id === 'data')
      return byteRate > 0 ? Math.floor((Math.min(size, bytes.length - offset - 8) * 1000) / byteRate) : null;
    offset += 8 + size + (size % 2);
  }
  return null;
}

export async function readRecordingFacts(path: string): AsyncResult<RecordingFacts> {
  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (cause) {
    return err(
      CloneSourceRefused(undefined, {
        detail: cause instanceof Error ? cause.message.slice(0, 200) : 'unreadable',
      }),
    );
  }
  const durationMs = wavDurationMs(bytes);
  if (durationMs === null) return err(CloneSourceRefused(undefined, { detail: 'not a WAV recording' }));
  return ok({ sha256: createHash('sha256').update(bytes).digest('hex'), durationMs });
}
