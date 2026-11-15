// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: the bars of a file's music (find-bars.ts), read with the bundled FFmpeg as mono at the finder's rate.
 * The samples are kept with the answer, so the seam of a stated repeat is measured on the same sound without
 * decoding again. No model.
 */
import { ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { decodeAudioFile } from '../pcm/decode';
import { findMusicBars, repeatSeam, type MusicBars, type RepeatSeam } from './find-bars';
import { BARS_SAMPLE_RATE } from './spectrum';

export interface MeasuredMusic {
  readonly bars: MusicBars;
  /** What a repeat joins where the music goes back `back` seconds at `at` (seconds of the file). */
  seam(at: number, back: number): RepeatSeam;
}

/** The bars of the first audio stream of `path`. A file with no sound is music with no steady pulse. */
export async function measureMusicFile(
  path: string,
  media: MediaContext,
  options: { readonly signal?: AbortSignal } = {},
): AsyncResult<MeasuredMusic> {
  const decoded = await decodeAudioFile(path, media, {
    sampleRate: BARS_SAMPLE_RATE,
    channels: 1,
    ...(options.signal ? { signal: options.signal } : {}),
  });
  if (!decoded.ok) return decoded;
  const mono = decoded.value.channels[0] ?? new Float32Array(0);
  return ok({ bars: findMusicBars(mono), seam: (at, back) => repeatSeam(mono, at, back) });
}
