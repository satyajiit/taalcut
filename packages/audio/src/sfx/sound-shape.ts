// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A generated sound's shape for placing it like a pack sound: its length and peak (largest absolute sample) from
 * the decoded audio, and its momentary-max loudness from ebur128.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ok, type AsyncResult } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import type { LoudnessMeter } from '../mix/loudness-series';
import { decodeAudioFile } from '../pcm/decode';

export interface SoundShape {
  readonly durationMs: number;
  readonly peakMs: number;
  readonly loudnessLufs: number;
}

const RATE = 48_000;

export async function measureSoundShape(
  deps: { readonly media: MediaContext; readonly meter: LoudnessMeter; readonly scratchDir?: string },
  bytes: Uint8Array,
  extension: string,
  signal?: AbortSignal,
): AsyncResult<SoundShape> {
  const dir = await mkdtemp(join(deps.scratchDir ?? tmpdir(), 'taalcut-sfx-'));
  try {
    const path = join(dir, `sound.${extension}`);
    await writeFile(path, bytes);
    const pcm = await decodeAudioFile(path, deps.media, {
      sampleRate: RATE,
      channels: 1,
      ...(signal ? { signal } : {}),
    });
    if (!pcm.ok) return pcm;
    const mono = pcm.value.channels[0] ?? new Float32Array();
    let peak = 0;
    let at = 0;
    mono.forEach((v, i) => {
      if (Math.abs(v) > peak) {
        peak = Math.abs(v);
        at = i;
      }
    });
    const loudness = await deps.meter.measure(path, signal);
    if (!loudness.ok) return loudness;
    return ok({
      durationMs: Math.max(1, Math.floor((mono.length * 1000) / RATE)),
      peakMs: Math.floor((at * 1000) / RATE),
      loudnessLufs: Math.max(-70, Math.min(0, Math.max(...loudness.value.momentary, -70))),
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
