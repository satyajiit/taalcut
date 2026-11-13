// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Conform drift, SDR SSIM, a crop and an HDR tone-map measured against zscale. */
import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { compareFrames, conform, sampleFrames, settledPlan, type MediaContext } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, hardwareHevcEncoder, planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('media conform');

describe.skipIf(!found.binaries)('conform', () => {
  let dir: string;
  let ctx: MediaContext;
  let h264: string[] | undefined;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-conform-'));
    ctx = { binaries: found.binaries! };
    h264 = await h264Encoder(ctx);
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('keeps a 60 s VFR clip inside one frame of drift after CFR', async (t) => {
    if (!h264) return t.skip('no H.264 encoder');
    const source = join(dir, 'vfr60.mp4');
    const okSource = await renderClip(ctx, source, [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=30',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000',
      '-t',
      '60',
      '-vf',
      "select='not(eq(mod(n\\,4)\\,0))'",
      '-fps_mode',
      'vfr',
      ...h264,
      '-c:a',
      'aac',
      '-b:a',
      '128k',
      '-shortest',
    ]);
    if (!okSource) return t.skip('VFR fixture was not encoded');
    const plan = await planClip(source, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const out = join(dir, 'vfr60-cfr.mp4');
    const made = await conform(source, plan.value, ctx, { out, codec: 'h264' });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    console.warn(`MEASURE vfr-60s-drift-ms ${made.value.driftMs}`);
    expect(Math.abs(made.value.driftMs)).toBeLessThan(20);
  }, 300_000);

  it('passes an SDR frame through at SSIM ≥ 0.99', async (t) => {
    if (!h264) return t.skip('no H.264 encoder');
    const source = join(dir, 'sdr.mp4');
    const encoded = await renderClip(ctx, source, [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=30',
      '-t',
      '1',
      '-vf',
      'scale=in_range=pc:out_range=tv,format=yuv420p',
      '-b:v',
      '8M',
      '-color_range',
      'tv',
      '-color_primaries',
      'bt709',
      '-color_trc',
      'bt709',
      '-colorspace',
      'bt709',
      ...h264,
    ]);
    if (!encoded) return t.skip('SDR fixture was not encoded');
    const plan = await planClip(source, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const out = join(dir, 'sdr-cfr.mp4');
    const made = await conform(source, plan.value, ctx, { out, codec: 'h264' });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const original = join(dir, 'sdr-a.png');
    const conformed = join(dir, 'sdr-b.png');
    const png = ['-vf', 'scale=in_range=tv:out_range=pc,format=rgb24', '-frames:v', '1'];
    expect(await renderClip(ctx, original, ['-i', source, ...png])).toBe(true);
    expect(await renderClip(ctx, conformed, ['-i', out, ...png])).toBe(true);
    const scored = await compareFrames(original, conformed, ctx, { metric: 'ssim' });
    expect(scored.ok).toBe(true);
    if (!scored.ok) return;
    console.warn(`MEASURE sdr-ssim ${scored.value.mean}`);
    expect(scored.value.mean).toBeGreaterThanOrEqual(0.99);
    const hashes: string[] = [];
    for (const file of [source, out]) {
      const working = file === out ? settledPlan(plan.value) : plan.value;
      const sampled = await sampleFrames(file, working, ctx, {
        frames: [0],
        size: 160,
        format: 'rgb24',
        onFrame: (frame) => hashes.push(createHash('sha256').update(frame.data).digest('hex')),
      });
      expect(sampled.ok).toBe(true);
    }
    console.warn(`MEASURE sample-hash-match ${hashes[0] === hashes[1]}`);
  }, 120_000);

  it('keeps only the crop, then scales it', async (t) => {
    if (!h264) return t.skip('no H.264 encoder');
    const source = join(dir, 'halves.mp4');
    const halves = 'color=c=red:size=320x240:rate=30,drawbox=x=160:y=0:w=160:h=240:color=blue:t=fill';
    if (!(await renderClip(ctx, source, ['-f', 'lavfi', '-i', halves, '-t', '1', ...h264])))
      return t.skip('halves fixture was not encoded');
    const plan = await planClip(source, ctx);
    if (!plan.ok) throw new Error(plan.error.code);
    const out = join(dir, 'halves-blue.mp4');
    const crop = { x: 160, y: 0, width: 160, height: 240 };
    const made = await conform(source, plan.value, ctx, { out, codec: 'h264', crop, maxLongSide: 120 });
    if (!made.ok) throw new Error(`${made.error.code}: ${made.error.detail ?? ''}`);
    expect([made.value.width, made.value.height]).toEqual([80, 120]);
    let red = 0;
    let blue = 0;
    const sampled = await sampleFrames(out, settledPlan(plan.value), ctx, {
      frames: [0],
      size: 120,
      format: 'rgb24',
      onFrame: (frame) => {
        for (let i = 0; i < frame.data.length; i += 3) {
          red += frame.data[i] ?? 0;
          blue += frame.data[i + 2] ?? 0;
        }
        red /= frame.data.length / 3;
        blue /= frame.data.length / 3;
      },
    });
    expect(sampled.ok).toBe(true);
    console.warn(`MEASURE crop-mean-rgb red ${red.toFixed(1)} blue ${blue.toFixed(1)}`);
    expect(blue).toBeGreaterThan(200);
    expect(red).toBeLessThan(40);
    const outside = await conform(source, plan.value, ctx, { out, codec: 'h264', crop: { ...crop, x: 200 } });
    expect(outside.ok ? 'ok' : outside.error.code).toBe('media.unsupported_media');
  }, 120_000);

  it('records HDR SSIM against a zscale reference', async (t) => {
    const hevc = await hardwareHevcEncoder(ctx);
    if (!hevc) return t.skip('no hardware HEVC encoder');
    const source = join(dir, 'hlg.mp4');
    const encoded = await renderClip(ctx, source, [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=25',
      '-t',
      '1',
      '-vf',
      'setparams=color_primaries=bt2020:color_trc=arib-std-b67:colorspace=bt2020nc:range=tv,format=p010le',
      '-c:v',
      hevc,
      '-profile:v',
      'main10',
      '-tag:v',
      'hvc1',
      '-b:v',
      '4M',
    ]);
    if (!encoded) return t.skip('HLG fixture was not encoded');
    const plan = await planClip(source, ctx);
    expect(plan.ok && plan.value.toneMap).toBe('required');
    if (!plan.ok) return;
    const out = join(dir, 'hlg-sdr.mp4');
    const made = await conform(source, plan.value, ctx, { out, codec: 'h264' });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    const reference = join(dir, 'hlg-zscale.png');
    const frame = join(dir, 'hlg-conform.png');
    const zscale = 'zscale=transfer=linear,tonemap=hable,zscale=transfer=bt709,format=rgb24';
    expect(await renderClip(ctx, reference, ['-i', source, '-vf', zscale, '-frames:v', '1'])).toBe(true);
    expect(await renderClip(ctx, frame, ['-i', out, '-frames:v', '1'])).toBe(true);
    const scored = await compareFrames(reference, frame, ctx, { metric: 'ssim' });
    expect(scored.ok).toBe(true);
    if (!scored.ok) return;
    console.warn(`MEASURE hdr-ssim ${scored.value.mean}`);
    expect(Number.isFinite(scored.value.mean)).toBe(true);
  }, 180_000);
});
