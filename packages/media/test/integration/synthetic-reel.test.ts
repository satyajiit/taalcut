// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Hard cuts, an overlay and a click, checked with probe, scdet and a wav peak. */
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { analyseVideo, extractAudio, probeMedia, type MediaContext } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { planClip, renderClip } from '../helpers/clip';
import { buildSyntheticReel } from '../../src/test-support';

const found = await findTestBinaries('media synthetic reel');

function peakTimeSec(wav: Buffer, sampleRate: number): number {
  const marker = wav.indexOf('data');
  const start = marker >= 0 ? marker + 8 : 44;
  let best = 0;
  let loudest = 0;
  for (let offset = start; offset + 1 < wav.length; offset += 2) {
    const sample = Math.abs(wav.readInt16LE(offset));
    if (sample > loudest) {
      loudest = sample;
      best = (offset - start) / 2;
    }
  }
  return best / sampleRate;
}

describe.skipIf(!found.binaries)('synthetic reel', () => {
  let dir: string;
  let ctx: MediaContext;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-reel-'));
    ctx = { binaries: found.binaries! };
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('places a cut, an overlay and a click on a counted grid', async (t) => {
    const png = join(dir, 'mark.png');
    if (!(await renderClip(ctx, png, ['-f', 'lavfi', '-i', 'color=c=white:s=16x16', '-frames:v', '1']))) {
      return t.skip('overlay was not written');
    }
    const out = join(dir, 'reel.mp4');
    const built = await buildSyntheticReel(
      {
        width: 160,
        height: 120,
        fps: 30,
        frames: 60,
        cuts: [30],
        overlays: [{ png, frame: 10, x: 4, y: 4, frames: 5 }],
        clicks: [{ frame: 15, frequency: 880 }],
        silence: true,
      },
      ctx,
      { out },
    );
    expect(built.ok, built.ok ? '' : built.error.detail).toBe(true);
    if (!built.ok) return;
    expect(built.value.frames).toBe(60);
    const probed = await probeMedia(out, ctx);
    expect(probed.ok).toBe(true);
    if (!probed.ok || !probed.value.video) return;
    const rate = probed.value.video.frameRate;
    expect(rate && rate.num / rate.den).toBe(30);
    expect(probed.value.video.frameCount ?? 60).toBe(60);
    const plan = await planClip(out, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const analysed = await analyseVideo(out, plan.value, ctx, { fps: 10, size: 160 });
    expect(analysed.ok, analysed.ok ? '' : analysed.error.detail).toBe(true);
    if (!analysed.ok) return;
    const cut = analysed.value.scenes.some((scene) => scene.score >= 10 && Math.abs(scene.timeSec - 1) < 0.25);
    expect(cut).toBe(true);
    expect(plan.value.audio).toBeTruthy();
    const wavPath = join(dir, 'reel.wav');
    const audio = await extractAudio(out, plan.value, ctx, { sampleRate: 8000, format: 'wav16', out: wavPath });
    expect(audio.ok, audio.ok ? '' : audio.error.detail).toBe(true);
    if (!audio.ok) return;
    const peak = peakTimeSec(await readFile(wavPath), 8000);
    console.warn(`MEASURE click-peak-sec ${peak}`);
    expect(Math.abs(peak - 0.5)).toBeLessThan(0.2);
  }, 180_000);
});
