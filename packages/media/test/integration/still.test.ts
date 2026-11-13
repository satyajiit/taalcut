// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Rotated stills, and photos as the library imports them: `.jpg`, `.JPG`,
 * `.png` and (where macOS `sips` can write one) `.heic`, probed, planned and
 * sampled through the confined input. HEIC can't be made with this LGPL
 * build (no HEIC encoder), so that case needs `sips`.
 */
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { promisify } from 'node:util';
import {
  detectEncoders,
  makeStill,
  planNormalisation,
  probeMedia,
  runFfmpeg,
  sampleFrames,
  type MediaContext,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('media still');

describe.skipIf(!found.binaries)('stills', () => {
  let dir: string;
  let ctx: MediaContext;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-still-'));
    ctx = { binaries: found.binaries! };
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('turns a display-matrix rotation into an upright JPEG', async (t) => {
    const h264 = await h264Encoder(ctx);
    if (!h264) return t.skip('no H.264 encoder');
    const source = join(dir, 'flat.mp4');
    const rotated = join(dir, 'turned.mov');
    if (
      !(await renderClip(ctx, source, [
        '-f',
        'lavfi',
        '-i',
        'testsrc2=size=320x240:rate=30',
        '-t',
        '1',
        ...h264,
      ]))
    ) {
      return t.skip('source was not encoded');
    }
    if (!(await renderClip(ctx, rotated, ['-display_rotation', '-90', '-i', source, '-c', 'copy']))) {
      return t.skip('rotation was not copied');
    }
    const plan = await planClip(rotated, ctx);
    expect(plan.ok && plan.value.rotation).toBe(90);
    if (!plan.ok) return;
    const out = join(dir, 'upright.jpg');
    const still = await makeStill(rotated, plan.value, ctx, { out });
    expect(still.ok && still.value).toMatchObject({ width: 240, height: 320 });
    const probed = await probeMedia(out, ctx);
    if (!probed.ok) throw new Error(`${probed.error.code}: ${probed.error.detail ?? ''}`);
    expect(probed.value.video?.width).toBe(240);
    expect(probed.ok && probed.value.video?.height).toBe(320);
  });

  it('probes, plans and samples .jpg, .JPG, .png and .heic photos', async (t) => {
    const jpg = join(dir, 'photo.jpg');
    const made = await runFfmpeg(ctx, [
      ...['-y', '-f', 'lavfi', '-i', 'testsrc2=size=640x480', '-frames:v', '1', jpg],
    ]);
    if (!made.ok) return t.skip('no still was encoded');
    await copyFile(jpg, join(dir, 'IMG_0001.JPG'));
    await runFfmpeg(ctx, ['-y', '-i', jpg, join(dir, 'photo.png')]);
    const names = ['photo.jpg', 'IMG_0001.JPG', 'photo.png'];
    if (process.platform === 'darwin') {
      const sips = await promisify(execFile)('sips', [
        '-s',
        'format',
        'heic',
        jpg,
        '--out',
        join(dir, 'photo.heic'),
      ])
        .then(() => true)
        .catch(() => false);
      if (sips) names.push('photo.heic');
    }
    for (const name of names) {
      const path = join(dir, name);
      const probed = await probeMedia(path, ctx);
      if (!probed.ok) throw new Error(`${name}: ${probed.error.code} ${probed.error.detail ?? ''}`);
      const plan = planNormalisation(probed.value);
      if (!plan.ok) throw new Error(`${name}: ${plan.error.code}`);
      expect(plan.value.kind).toBe('image');
      const sizes: number[] = [];
      const sampled = await sampleFrames(path, plan.value, ctx, {
        size: 64,
        format: 'rgb24',
        onFrame: (frame) => sizes.push(frame.width * frame.height * 3 - frame.data.length),
      });
      if (!sampled.ok) throw new Error(`${name}: ${sampled.error.code} ${sampled.error.detail ?? ''}`);
      expect(sizes).toEqual([0]);
    }
  });

  it('skips a HEIC grid when the build cannot encode one', async (t) => {
    const encoders = await detectEncoders(ctx);
    const heic = encoders.ok && encoders.value.encoders.some((encoder) => /heic|heif/i.test(encoder.name));
    if (!heic) t.skip('FFmpeg 9.0.2 LGPL build has no HEIC encoder');
  });
});
