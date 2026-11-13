// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Scene scores, black, freeze, loudness, SSIM, audio extract and a contact sheet. */
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  analyseVideo,
  compareFrames,
  contactSheet,
  extractAudio,
  measureLoudness,
  sampleFrames,
  type MediaContext,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('media primitives');

describe.skipIf(!found.binaries)('primitives', () => {
  let dir: string;
  let ctx: MediaContext;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-prim-'));
    ctx = { binaries: found.binaries! };
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('returns one buffer per requested frame', async (t) => {
    const h264 = await h264Encoder(ctx);
    if (!h264) return t.skip('no H.264 encoder');
    const source = join(dir, 'sample.mp4');
    if (
      !(await renderClip(ctx, source, [
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x240:rate=30:duration=1',
        ...h264,
      ]))
    ) {
      return t.skip('source was not encoded');
    }
    const plan = await planClip(source, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    let seen = 0;
    const sampled = await sampleFrames(source, plan.value, ctx, {
      frames: [0, 10, 20],
      size: 160,
      format: 'rgb24',
      onFrame: (frame) => {
        seen += 1;
        expect(frame.data.length).toBe(frame.width * frame.height * 3);
      },
    });
    expect(sampled.ok, sampled.ok ? '' : sampled.error.detail).toBe(true);
    if (!sampled.ok) return;
    expect(sampled.value.frames).toBe(3);
    expect(seen).toBe(3);
  }, 120_000);

  it('logs loudness of an 8 s sine near -23 dBFS', async (t) => {
    const source = join(dir, 'tone.wav');
    // This build's sine source has no amplitude option. Its full-scale peak is about -18 dBFS, so -5 dB lands near -23.
    const tone = 'sine=frequency=1000:sample_rate=48000:duration=8,volume=-5dB';
    if (!(await renderClip(ctx, source, ['-f', 'lavfi', '-i', tone]))) {
      return t.skip('sine was not encoded');
    }
    const reading = await measureLoudness(source, ctx);
    expect(reading.ok, reading.ok ? '' : reading.error.detail).toBe(true);
    if (!reading.ok) return;
    console.warn(`MEASURE loudness-lufs ${reading.value.integratedLufs}`);
    console.warn(`MEASURE loudness-peak ${reading.value.truePeakDbtp}`);
    expect(reading.value.integratedLufs).toBeGreaterThan(-32);
    expect(reading.value.integratedLufs).toBeLessThan(-14);
    expect(Number.isFinite(reading.value.truePeakDbtp)).toBe(true);
  }, 120_000);

  it('finds black and a freeze on flat colour clips', async (t) => {
    const h264 = await h264Encoder(ctx);
    if (!h264) return t.skip('no H.264 encoder');
    const black = join(dir, 'black.mp4');
    const frozen = join(dir, 'frozen.mp4');
    const blackOk = await renderClip(ctx, black, [
      '-f',
      'lavfi',
      '-i',
      'color=c=black:s=160x120:r=25:d=2.5',
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=160x120:r=25:d=0.5',
      '-filter_complex',
      'concat=n=2:v=1:a=0',
      ...h264,
      '-b:v',
      '4M',
      '-fps_mode',
      'cfr',
    ]);
    const freezeOk = await renderClip(ctx, frozen, [
      '-f',
      'lavfi',
      '-i',
      'color=c=red:s=160x120:r=25:d=3',
      ...h264,
      '-b:v',
      '4M',
      '-fps_mode',
      'cfr',
    ]);
    if (!blackOk || !freezeOk) return t.skip('colour clips were not encoded');
    const blackPlan = await planClip(black, ctx);
    const freezePlan = await planClip(frozen, ctx);
    expect(blackPlan.ok && freezePlan.ok).toBe(true);
    if (!blackPlan.ok || !freezePlan.ok) return;
    const blacks = await analyseVideo(black, blackPlan.value, ctx, { fps: 5, size: 160 });
    const freezes = await analyseVideo(frozen, freezePlan.value, ctx, { fps: 5, size: 160 });
    expect(blacks.ok, blacks.ok ? '' : blacks.error.detail).toBe(true);
    expect(freezes.ok, freezes.ok ? '' : freezes.error.detail).toBe(true);
    if (!blacks.ok || !freezes.ok) return;
    expect(blacks.value.black.some((span) => span.startSec < 0.5 && span.endSec > 1.5)).toBe(true);
    expect(freezes.value.freeze.length).toBeGreaterThan(0);
  }, 180_000);

  it('scores identical frames near 1 and lays out a contact sheet', async (t) => {
    const h264 = await h264Encoder(ctx);
    if (!h264) return t.skip('no H.264 encoder');
    const source = join(dir, 'sheet.mp4');
    if (
      !(await renderClip(ctx, source, [
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x240:rate=30:duration=1',
        ...h264,
      ]))
    ) {
      return t.skip('source was not encoded');
    }
    const plan = await planClip(source, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const png = join(dir, 'frame.png');
    if (!(await renderClip(ctx, png, ['-i', source, '-frames:v', '1'])))
      return t.skip('frame was not written');
    const same = await compareFrames(png, png, ctx, { metric: 'ssim' });
    expect(same.ok, same.ok ? '' : same.error.detail).toBe(true);
    if (!same.ok) return;
    expect(same.value.mean).toBeGreaterThan(0.99);
    const out = join(dir, 'sheet.jpg');
    const sheet = await contactSheet(source, plan.value, ctx, {
      frames: [0, 10, 20],
      columns: 2,
      tileLongSide: 80,
      out,
    });
    expect(sheet.ok, sheet.ok ? '' : sheet.error.detail).toBe(true);
    if (!sheet.ok) return;
    expect(sheet.value.tiles).toHaveLength(3);
    expect(sheet.value.width).toBe(sheet.value.tiles[0]!.width * 2);
    expect(sheet.value.height).toBe(sheet.value.tiles[0]!.height * 2);
    const bytes = await readFile(out);
    expect(bytes[0]).toBe(0xff);
    expect(bytes[1]).toBe(0xd8);
  }, 120_000);

  it('writes a mono RIFF wav', async (t) => {
    const h264 = await h264Encoder(ctx);
    if (!h264) return t.skip('no H.264 encoder');
    const source = join(dir, 'talk.mp4');
    const encoded = await renderClip(ctx, source, [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=160x120:rate=30:duration=1',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=1',
      '-shortest',
      ...h264,
      '-c:a',
      'aac',
    ]);
    if (!encoded) return t.skip('source was not encoded');
    const plan = await planClip(source, ctx);
    expect(plan.ok && Boolean(plan.ok && plan.value.audio)).toBe(true);
    if (!plan.ok || !plan.value.audio) return;
    const out = join(dir, 'talk.wav');
    const audio = await extractAudio(source, plan.value, ctx, { sampleRate: 8000, format: 'wav16', out });
    expect(audio.ok, audio.ok ? '' : audio.error.detail).toBe(true);
    if (!audio.ok) return;
    expect(audio.value).toEqual({ sampleRate: 8000, channels: 1 });
    const wav = await readFile(out);
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
  }, 120_000);
});
