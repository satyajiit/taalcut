// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Writing PCM to a file with the bundled FFmpeg: the float WAV goes to a scratch file next to the target, FFmpeg
 * encodes it (FLAC for warped music and stretched lines, 48 kHz WAV for stems), and the scratch file is removed.
 */
import { rm, writeFile } from 'node:fs/promises';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { AudioWriteFailed } from '../errors';
import { encodeFloatWav, type Pcm } from './pcm';

export type PcmFileFormat = 'flac' | 'wav16' | 'wavf32';

const CODEC: Record<PcmFileFormat, readonly string[]> = {
  flac: ['-c:a', 'flac', '-compression_level', '5'],
  wav16: ['-c:a', 'pcm_s16le'],
  wavf32: ['-c:a', 'pcm_f32le'],
};

export async function writePcmFile(
  pcm: Pcm,
  path: string,
  format: PcmFileFormat,
  media: MediaContext,
  signal?: AbortSignal,
): AsyncResult<{ readonly path: string }> {
  const scratch = `${path}.${process.pid}.src.wav`;
  try {
    await writeFile(scratch, encodeFloatWav(pcm));
  } catch (cause) {
    return err(AudioWriteFailed(undefined, { detail: cause instanceof Error ? cause.message.slice(0, 300) : 'write failed' }));
  }
  const encoded = await runFfmpeg(media, ['-nostdin', '-y', '-i', scratch, ...CODEC[format], path], {
    // Audio only: a stop keeps SIGTERM then SIGKILL (IX3-K2).
    holdsVideoSession: false,
    timeoutMs: 180_000,
    ...(signal ? { signal } : {}),
  });
  await rm(scratch, { force: true });
  return encoded.ok ? ok({ path }) : encoded;
}

