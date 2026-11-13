// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Click-and-pad "music" for the warp tests, and a click-onset tracker that stands in for Beat This! on it:
 * downbeat clicks are louder, so the tracker can tell bars apart. Sample-accurate on clicks, nothing more.
 */
import { err, ok, type MusicProvider, type MusicRequest } from '@taalcut/core';
import { decodeAudioFile } from '../../src/pcm/decode';
import { encodeFloatWav, type Pcm } from '../../src/pcm/pcm';
import type { BeatGrid } from '../../src/music/beat-grid';
import type { MusicBeatTracker } from '../../src/music/warp-track';
import type { MediaContext } from '@taalcut/media';

export const RATE = 48_000;

export interface ClickTrackSpec {
  readonly bpm: number;
  readonly seconds: number;
  /** Each bar's length is multiplied by this (jitter). */
  readonly barFactor?: (bar: number) => number;
  /** Silence before the first downbeat, ms. */
  readonly leadMs?: number;
}

export function clickTrack(spec: ClickTrackSpec): Pcm {
  const frames = Math.round(spec.seconds * RATE);
  const left = new Float32Array(frames);
  for (let i = 0; i < frames; i++) left[i] = 0.04 * Math.sin((2 * Math.PI * 220 * i) / RATE);
  const beatSec = 60 / spec.bpm;
  let t = (spec.leadMs ?? 0) / 1000;
  for (let beat = 0; t < spec.seconds; beat++) {
    const bar = Math.floor(beat / 4);
    const amplitude = beat % 4 === 0 ? 0.9 : 0.45;
    const start = Math.round(t * RATE);
    for (let i = 0; i < 600 && start + i < frames; i++)
      left[start + i] =
        (left[start + i] ?? 0) + amplitude * Math.sin((2 * Math.PI * 2000 * i) / RATE) * Math.exp(-i / 90);
    t += beatSec * (spec.barFactor?.(bar) ?? 1);
  }
  return { sampleRate: RATE, channels: [left, left.slice()] };
}

/** Onsets of clicks in mono PCM: the first sample over 0.25 after 120 ms under it; louder than 0.7 is a downbeat. */
export function clickGrid(samples: Float32Array, sampleRate: number): BeatGrid {
  const beatsMs: number[] = [];
  const downbeats: number[] = [];
  const quiet = Math.round(0.12 * sampleRate);
  let lastLoud = -quiet;
  for (let i = 0; i < samples.length; i++) {
    const value = Math.abs(samples[i] ?? 0);
    if (value <= 0.25) continue;
    if (i - lastLoud >= quiet) {
      let peak = 0;
      for (let j = i; j < Math.min(samples.length, i + 200); j++)
        peak = Math.max(peak, Math.abs(samples[j] ?? 0));
      if (peak > 0.7) downbeats.push(beatsMs.length);
      beatsMs.push((i * 1000) / sampleRate);
    }
    lastLoud = i;
  }
  return { beatsMs, downbeats };
}

export function clickTracker(media: MediaContext): MusicBeatTracker & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async track(path, signal) {
      calls.push(path);
      const pcm = await decodeAudioFile(path, media, {
        sampleRate: RATE,
        channels: 1,
        ...(signal ? { signal } : {}),
      });
      if (!pcm.ok) return pcm;
      return ok(clickGrid(pcm.value.channels[0] ?? new Float32Array(), RATE));
    },
  };
}

/** A MusicProvider that answers each compose with a click track whose tempo is the asked one times `error(call)`. */
export function clickMusicProvider(
  error: (call: number) => number,
  options: { readonly seconds?: number; readonly barFactor?: (bar: number) => number } = {},
) {
  const requests: MusicRequest[] = [];
  const provider: MusicProvider & { readonly requests: MusicRequest[] } = {
    requests,
    available: () => ({ ok: true }),
    async compose(request) {
      requests.push(request);
      if (request.plan.kind !== 'chunks')
        return err({ code: 'test.prompt', messageKey: 'x', retryable: false });
      const style = request.plan.chunks[0]?.positiveStyles.find((s) => s.endsWith(' BPM')) ?? '100 BPM';
      const bpm = Number.parseInt(style, 10) * error(requests.length);
      const pcm = clickTrack({
        bpm,
        seconds: options.seconds ?? 40,
        leadMs: 180,
        ...(options.barFactor ? { barFactor: options.barFactor } : {}),
      });
      return ok({
        bytes: new Uint8Array(encodeFloatWav(pcm)),
        mediaType: 'audio/wav',
        provider: 'test',
        model: 'clicks',
        songId: `song-${requests.length}`,
        costUsd: 0.1,
        estimated: true,
        c2pa: 'absent',
      });
    },
  };
  return provider;
}
