// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Proxy size against a short 4K HEVC clip, reuse, and upright SDR output. */
import { stat } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeProxy, probeMedia, type MediaContext } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, hardwareHevcEncoder, planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('media proxy');

describe.skipIf(!found.binaries)('proxy', () => {
  let dir: string;
  let ctx: MediaContext;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-proxy-'));
    ctx = { binaries: found.binaries! };
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('keeps a short 4K proxy at or under 15% of a high-bitrate original', async (t) => {
    const hevc = await hardwareHevcEncoder(ctx);
    if (!hevc) return t.skip('no hardware HEVC encoder');
    const source = join(dir, '4k.mp4');
    const encoded = await renderClip(ctx, source, [
      '-f', 'lavfi', '-i', 'testsrc2=size=3840x2160:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000',
      '-t', '2',
      '-c:v', hevc, '-b:v', '40M', '-tag:v', 'hvc1', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-shortest',
    ]);
    if (!encoded) return t.skip('4K fixture was not encoded');
    const plan = await planClip(source, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const size = (await stat(source)).size;
    const out = join(dir, '4k-proxy.mp4');
    const made = await makeProxy(source, plan.value, ctx, { out, sizeBytes: size, contentHash: 'ef'.repeat(32) });
    expect(made.ok).toBe(true);
    if (!made.ok) return;
    console.warn(`MEASURE 4k-2s-proxy-ratio ${made.value.ratio}`);
    expect(made.value.reusedOriginal).toBe(false);
    expect(made.value.ratio).toBeLessThanOrEqual(0.15);
    const probed = await probeMedia(out, ctx);
    expect(probed.ok && probed.value.video).toMatchObject({
      codec: 'h264',
      pixelFormat: 'yuv420p',
    });
    expect(probed.ok && probed.value.video?.colour.transfer).toBe('bt709');
  }, 180_000);

  it('reuses a preview-friendly original when the budget is under the floor', async (t) => {
    const h264 = await h264Encoder(ctx);
    if (!h264) return t.skip('no H.264 encoder');
    const source = join(dir, 'small.mp4');
    if (!(await renderClip(ctx, source, ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '1', ...h264]))) {
      return t.skip('small fixture was not encoded');
    }
    const plan = await planClip(source, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const made = await makeProxy(source, plan.value, ctx, { out: join(dir, 'unused.mp4'), sizeBytes: 1000 });
    expect(made.ok && made.value.reusedOriginal).toBe(true);
  });

  it('writes an upright proxy of a rotated clip', async (t) => {
    const h264 = await h264Encoder(ctx);
    if (!h264) return t.skip('no H.264 encoder');
    const flat = join(dir, 'flat.mp4');
    const turned = join(dir, 'turned.mov');
    if (!(await renderClip(ctx, flat, ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30', '-t', '1', ...h264]))) {
      return t.skip('flat fixture was not encoded');
    }
    if (!(await renderClip(ctx, turned, ['-display_rotation', '-90', '-i', flat, '-c', 'copy']))) {
      return t.skip('rotation was not copied');
    }
    const plan = await planClip(turned, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const out = join(dir, 'turned-proxy.mp4');
    const size = (await stat(turned)).size;
    const made = await makeProxy(turned, plan.value, ctx, { out, sizeBytes: Math.max(size, 5_000_000) });
    expect(made.ok && made.value.reusedOriginal).toBe(false);
    const probed = await probeMedia(out, ctx);
    expect(probed.ok && probed.value.video?.width).toBe(240);
    expect(probed.ok && probed.value.video?.height).toBe(320);
    expect(probed.ok && (probed.value.video?.rotation ?? 0)).toBe(0);
  });
});
