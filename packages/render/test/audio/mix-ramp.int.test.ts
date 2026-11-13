// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A ramped clip's sound with the bundled FFmpeg (SPEC sections 3 and 8): the mixer's piece graph runs,
 * keeps the exact length, and puts a source click where the ramp plays it. Linear 0.5× → 2× over 60
 * frames at 30 fps: 27 frames in, 22.6125 frames of source have played; the mean speed (1.25) would
 * play that click at frame 18.09.
 */
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, RationalTime } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { renderMix } from '../../src/audio/mix';
import { planAudioMix } from '../../src/audio/mix-plan';
import { findTestMedia, mediaContext, tempDir } from '../support/media';
import { decodePcm, evalWav, onset, planOf, pulseAt } from './helpers';

const media = await findTestMedia('render mix ramp');
const rate = FrameRate.of(30);
const hz = FrameRate.of(48000);
const SOURCE_CLICK = Math.round(22.6125 * 1600);

describe.skipIf(!media.binaries)('mix of a speed ramp', () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('mix-ramp');
  });
  afterAll(() => work?.dispose());

  it('plays the click where the ramp puts it and lasts exactly the clip', async () => {
    const source = await evalWav(ctx, work.dir, 'click', pulseAt(SOURCE_CLICK, 0.5, 96), 240_000);
    const speed = {
      curve: 'linear' as const,
      points: [
        { at: RationalTime.of(0, rate), speed: 0.5 },
        { at: RationalTime.of(60, rate), speed: 2 },
      ],
    };
    const plan = planOf({ rate, items: [{ frames: 60, sourceStart: 0, speed }] });
    const mix = planAudioMix(plan, { clip: () => ({ path: source, offset: RationalTime.of(0, hz) }) });
    if (!mix.ok) throw new Error(mix.error.code);
    const wav = await renderMix(mix.value, ctx, { out: join(work.dir, 'ramp.wav') });
    if (!wav.ok) throw new Error(`${wav.error.code}: ${wav.error.detail ?? ''}`);
    const pcm = await decodePcm(ctx, wav.value.path);
    expect(pcm.length).toBe(60 * 1600);
    // Frame 27 is sample 43200; atempo's overlap-add may move an edge by up to half its window (~20 ms),
    // inside the frame. The mean speed would put it 14,250 samples early.
    expect(Math.abs(onset(pcm, 0.2) - 27 * 1600)).toBeLessThan(1600);
  });
});
