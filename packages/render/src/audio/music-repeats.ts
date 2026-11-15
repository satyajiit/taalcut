// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1: the reel's own music played with bars again (core's music-repeats.ts), as mix segments. The music bed is
 * one segment that plays the reel straight through; each repeat cuts it where the music goes back, so the bed
 * becomes one segment per stretch, each reading the reel that much earlier. Where two stretches meet, the one
 * before fades out to the splice and the one after starts a crossfade's length early and fades in to it. The
 * fades are linear: the two sides are the same bars of one recording, so their sum keeps its level (an
 * equal-power curve, right for unlike sounds, would swell it by up to 3 dB). Every position is a whole sample, so
 * the stretches tile exactly and the mix keeps its length. Pure.
 */
import type { MusicRepeat } from '@taalcut/core';
import { toSamples, type MixSegment } from './mix-types';

/**
 * `segment` (the reel's music laid as one bed: sample `inSample + n` of the reel at its n-th sample) cut at each
 * repeat. The music's clock is the reel's own time before any repeat, so a clock time is found on the render from
 * the bed itself, wherever the bed's window and shift put it.
 */
export function withMusicRepeats(segment: MixSegment, repeats: readonly MusicRepeat[]): MixSegment[] {
  if (repeats.length === 0) return [segment];
  const end = segment.startSample + segment.samples;
  const renderAt = (clock: number) => segment.startSample + (clock - segment.inSample);
  const piece = (
    from: number,
    to: number,
    back: number,
    fades: Pick<MixSegment, 'fadeInSamples' | 'fadeOutSamples' | 'fadeInCurve' | 'fadeOutCurve'>,
  ): MixSegment => ({
    ...segment,
    inSample: segment.inSample + (from - segment.startSample) - back,
    startSample: from,
    samples: to - from,
    ...fades,
  });
  const out: MixSegment[] = [];
  // How far back the reel is read, and where the stretch being laid starts: with its lead-in, and without.
  let back = 0;
  let from = segment.startSample;
  let solid = segment.startSample;
  let fadeIn: Pick<MixSegment, 'fadeInSamples' | 'fadeInCurve'> = { fadeInSamples: segment.fadeInSamples };
  for (const repeat of repeats) {
    const at = renderAt(toSamples(repeat.at));
    const length = toSamples(repeat.length);
    if (at >= end) break;
    if (at <= solid) {
      // The splice is before the bed sounds (its window starts later): only the reading moves.
      back += length;
      continue;
    }
    const cross = Math.max(0, Math.min(toSamples(repeat.crossfade), at - solid));
    out.push(
      piece(from, at, back, {
        ...fadeIn,
        fadeOutSamples: cross,
        ...(cross > 0 ? { fadeOutCurve: 'linear' as const } : {}),
      }),
    );
    back += length;
    from = at - cross;
    solid = at;
    fadeIn = { fadeInSamples: cross, ...(cross > 0 ? { fadeInCurve: 'linear' as const } : {}) };
  }
  out.push(piece(from, end, back, { ...fadeIn, fadeOutSamples: segment.fadeOutSamples }));
  return out;
}
