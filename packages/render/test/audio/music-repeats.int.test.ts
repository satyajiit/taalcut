// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LONG1 with the bundled FFmpeg: the reel's music with two bars played again, measured in the mixed sound. The
 * reel is synthetic: 470 frames at 30 a second, a steady tone, a click on every beat of a tempo whose two bars are
 * 129 frames (the first bar at 1.5 s), and a second tone from the drop at 10.1 s. The video is 599 frames and the
 * music goes back 129 frames at 10.095 s with a 50 ms crossfade. Measured: the mix is the plan's length; it is the
 * reel to the sample before the splice and the reel 129 frames earlier after it; there is no gap and no jump in
 * level across the splice; every later hit, the drop included, is 129 frames later.
 */
import { join } from 'node:path';
import { FrameRate, newId, RationalTime, type MusicRepeat } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { renderMix } from '../../src/audio/mix';
import { planAudioMix } from '../../src/audio/mix-plan';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { decodePcm, evalWav, planOf, rms } from './helpers';

const media = await findTestMedia('render music repeats');
const rate = FrameRate.of(30);
const hz = FrameRate.of(48_000);

const REEL = 752_000; // 470 frames
const BEAT = 25_800; // 0.5375 s: eight of them are 4.3 s, 129 frames
const FIRST_BAR = 72_000; // 1.5 s
const DROP = 484_800; // 10.1 s, a bar line
const BACK = 206_400; // 129 frames
const AT = 484_560; // 5 ms before the drop
const CROSS = 2400; // 50 ms
const CLICK = 48;

/** The reel's sound: a 1 kHz tone, a click on each beat from the first bar, a 250 Hz tone from the drop. */
const REEL_EXPR =
  `0.2*sin(2*PI*1000*n/48000)` +
  `+if(gte(n,${FIRST_BAR})*lt(mod(n-${FIRST_BAR},${BEAT}),${CLICK}),0.5,0)` +
  `+if(gte(n,${DROP}),0.2*sin(2*PI*250*n/48000),0)`;

const OWNER: MusicRepeat = {
  at: RationalTime.of(AT, hz),
  length: RationalTime.of(129, rate),
  crossfade: RationalTime.of(CROSS, hz),
  bars: 2,
  slotId: null,
};

/** Samples where a click starts: the sound steps up by the click's height from one sample to the next. */
function clicks(pcm: Float32Array): number[] {
  const out: number[] = [];
  for (let n = 1; n < pcm.length; n++) if (pcm[n]! - pcm[n - 1]! > 0.3) out.push(n);
  return out;
}

describe.skipIf(!media.binaries)('the reel’s music with two bars played again, mixed (LONG1)', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let reel: Float32Array;
  let mixed: Float32Array;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('music-repeats');
    const path = await evalWav(ctx, work.dir, 'reel', REEL_EXPR, REEL);
    reel = await decodePcm(ctx, path);
    const plan = {
      ...planOf({
        rate,
        items: [
          { frames: 432, muted: true },
          { frames: 167, muted: true },
        ],
        music: { path: 'referenceAudio', templateId: newId<'Template'>(), gainDb: 0 },
      }),
      musicRepeats: [OWNER],
    };
    const mix = planAudioMix(plan, { clip: () => undefined, reference: { path } });
    if (!mix.ok) throw new Error(mix.error.code);
    const out = join(work.dir, 'mix.wav');
    const rendered = await renderMix(mix.value, ctx, { out });
    if (!rendered.ok) throw new Error(rendered.error.code);
    mixed = await decodePcm(ctx, out);
  }, 120_000);
  afterAll(() => work?.dispose());

  const worst = (from: number, to: number, expected: (n: number) => number) => {
    let max = 0;
    for (let n = from; n < to; n++) max = Math.max(max, Math.abs(mixed[n]! - expected(n)));
    return max;
  };

  it('is 599 frames long: the reel’s 470 and the 129 played again', () => {
    expect(reel.length).toBe(REEL);
    expect(mixed.length).toBe(958_400);
    expect(mixed.length - reel.length).toBe(BACK);
  });

  it('is the reel to the sample before the splice, and the reel 129 frames earlier after it', () => {
    expect(worst(0, AT - CROSS, (n) => reel[n]!)).toBeLessThan(1e-4);
    expect(worst(AT, mixed.length, (n) => reel[n - BACK]!)).toBeLessThan(1e-4);
    // Across the crossfade: the two sides summed with gains that add to one, sample by sample.
    const crossed = (n: number) => {
      const gain = (n - (AT - CROSS)) / CROSS;
      return (1 - gain) * reel[n]! + gain * reel[n - BACK]!;
    };
    expect(worst(AT - CROSS, AT, crossed)).toBeLessThan(2e-3);
  });

  it('has no gap and no jump in level across the splice', () => {
    // The steady tone alone sounds here (no click within 100 ms before the splice): its level, 5 ms at a time.
    const tone = rms(reel, 400_000, 400_240);
    const levels: number[] = [];
    for (let from = AT - 4800; from + 240 <= AT; from += 240) levels.push(rms(mixed, from, from + 240));
    const db = levels.map((level) => 20 * Math.log10(level / tone));
    expect(Math.min(...db)).toBeGreaterThan(-0.1);
    expect(Math.max(...db)).toBeLessThan(0.1);
    // No sample steps by more than the tone itself does from one sample to the next (a cut would).
    let step = 0;
    for (let n = AT - 4800; n < AT; n++) step = Math.max(step, Math.abs(mixed[n]! - mixed[n - 1]!));
    expect(step).toBeLessThan(0.2 * 2 * Math.PI * (1000 / 48_000) * 1.05);
  });

  it('plays the two bars before the drop again, and every later hit is 129 frames later', () => {
    const inReel = clicks(reel);
    const inMix = clicks(mixed);
    // Beats from the first bar: 27 in the reel; the 8 of the two bars before the drop sound twice.
    expect(inReel).toHaveLength(27);
    expect(inReel[0]).toBe(FIRST_BAR);
    expect(inReel[16]).toBe(DROP);
    expect(inMix).toHaveLength(35);
    expect(inMix.slice(0, 16)).toEqual(inReel.slice(0, 16));
    // From the splice on, each click is the reel's 129 frames (206 400 samples) later, the played-again bars first.
    expect(inMix.slice(16)).toEqual(inReel.slice(8).map((n) => n + BACK));
    expect(inMix[16]).toBe(DROP);
    // The drop: the second tone starts at 10.1 s of the reel, and at 14.4 s (frame 432) of the video.
    const low = (pcm: Float32Array, from: number) => rms(pcm, from, from + 4800);
    expect(low(mixed, DROP + CLICK)).toBeCloseTo(low(reel, DROP - BACK + CLICK), 3);
    expect(low(mixed, DROP + BACK + CLICK)).toBeCloseTo(low(reel, DROP + CLICK), 3);
    expect(low(mixed, DROP + BACK + CLICK)).toBeGreaterThan(low(mixed, DROP + CLICK) * 1.3);
    expect((DROP + BACK) / 1600).toBe(432);
  });
});
