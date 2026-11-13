// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `detectCrop` and a cropped `normalise` on synthetic clips made with lavfi: a phone screen recording (static
 * chrome, a status-bar clock that ticks once, a reel that changes every second), a reel that fills the frame,
 * and a letterboxed 16:9 picture. The cropped normalise encodes with VideoToolbox (run under the VT lock).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FrameRate, ok } from '@taalcut/core';
import { probeMedia, runFfmpeg, type MediaContext } from '@taalcut/media';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { breakdownMedia } from '../src/utility/roots/template-analysers';
import { testFfmpeg } from './helpers/test-ffmpeg';

const resolved = await testFfmpeg('crop detect');
if (!resolved.ok) console.warn(`crop detect: skipped, no FFmpeg (${resolved.error.code})`);

const root = mkdtempSync(join(tmpdir(), 'taalcut-desktop-crop-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

/** Inverts the picture every other second: every pixel of it changes, as at a cut. */
const flicker = "negate=enable='lt(mod(t\\,2)\\,1)'";
const encode = ['-t', '6', ...softwareH264FixtureFlags(), '-b:v', '4M', '-pix_fmt', 'yuv420p'];
const screenReel = { x: 30, y: 106, width: 480, height: 854 };

const clips = {
  screen: [
    ...['-f', 'lavfi', '-i', 'color=c=0xeeeeee:s=540x1170:r=30:d=6'],
    ...['-f', 'lavfi', '-i', `testsrc2=s=${screenReel.width}x${screenReel.height}:r=30:d=6`],
    '-filter_complex',
    [
      `[1:v]${flicker}[reel]`,
      `[0:v][reel]overlay=x=${screenReel.x}:y=${screenReel.y}`,
      'drawbox=x=24:y=30:w=90:h=36:color=0x222222:t=fill',
      // The clock's last digit changes once, at 3 s.
      "drawbox=x=430:y=30:w=40:h=36:color=0x222222:t=fill:enable='gte(t\\,3)'",
      'drawbox=x=40:y=1090:w=60:h=50:color=0x555555:t=fill',
      'drawbox=x=440:y=1090:w=60:h=50:color=0x555555:t=fill[v]',
    ].join(','),
    ...['-map', '[v]'],
  ],
  full: ['-f', 'lavfi', '-i', 'testsrc2=s=540x960:r=30:d=6', '-vf', flicker],
  letterbox: [
    '-f',
    'lavfi',
    '-i',
    'testsrc2=s=540x304:r=30:d=6',
    '-vf',
    `${flicker},pad=540:960:0:328:black`,
  ],
} as const;

const ctx: MediaContext | undefined = resolved.ok ? { binaries: resolved.value } : undefined;
function context(): MediaContext {
  if (!ctx) throw new Error('no FFmpeg');
  return ctx;
}

describe.skipIf(!ctx)('screen-recording crop on real media', () => {
  const media = breakdownMedia({ media: async () => ok(context()), onFallback: () => {} });
  const path = (name: keyof typeof clips) => join(root, `${name}.mp4`);
  const signal = new AbortController().signal;

  async function detect(name: keyof typeof clips) {
    const found = await media.detectCrop?.(path(name), { signal });
    if (!found) throw new Error('breakdownMedia offers no detectCrop');
    if (!found.ok) throw new Error(`${found.error.code}: ${found.error.detail ?? ''}`);
    console.warn(`MEASURE crop ${name} ${JSON.stringify(found.value)}`);
    return found.value;
  }

  beforeAll(async () => {
    for (const [name, args] of Object.entries(clips)) {
      const out = join(root, `${name}.mp4`);
      const made = await runFfmpeg(context(), ['-y', ...args, ...encode, out], { timeoutMs: 120_000 });
      if (!made.ok) throw new Error(`${name}: ${made.error.detail ?? made.error.code}`);
    }
  });

  it('finds the reel inside a screen recording, within 2% of each side', async () => {
    const crop = await detect('screen');
    expect(crop).not.toBeNull();
    if (!crop) return;
    expect(Math.abs(crop.x - screenReel.x)).toBeLessThanOrEqual(540 * 0.02);
    expect(Math.abs(crop.x + crop.width - (screenReel.x + screenReel.width))).toBeLessThanOrEqual(540 * 0.02);
    expect(Math.abs(crop.y - screenReel.y)).toBeLessThanOrEqual(1170 * 0.02);
    expect(Math.abs(crop.y + crop.height - (screenReel.y + screenReel.height))).toBeLessThanOrEqual(
      1170 * 0.02,
    );
  }, 60_000);

  it('answers no crop for a reel that fills the frame', async () => {
    expect(await detect('full')).toBeNull();
  }, 60_000);

  it('crops a letterboxed picture to the picture', async () => {
    const crop = await detect('letterbox');
    expect(crop).not.toBeNull();
    if (!crop) return;
    expect(crop.x).toBe(0);
    expect(crop.width).toBe(540);
    expect(Math.abs(crop.y - 328)).toBeLessThanOrEqual(960 * 0.02);
    expect(Math.abs(crop.y + crop.height - 632)).toBeLessThanOrEqual(960 * 0.02);
  }, 60_000);

  it('normalises only the reel, at the asked width', async () => {
    const crop = { x: 30, y: 106, width: 480, height: 854 };
    const out = join(root, 'screen-normalised.mp4');
    const made = await media.normalise(path('screen'), {
      outPath: out,
      rate: FrameRate.of(30),
      width: 240,
      crop,
      signal,
    });
    if (!made.ok) throw new Error(`${made.error.code}: ${made.error.detail ?? ''}`);
    expect(made.value.frames).toBe(180);
    const probed = await probeMedia(out, context());
    if (!probed.ok) throw new Error(probed.error.code);
    expect([probed.value.video?.width, probed.value.video?.height]).toEqual([240, 426]);
    const outside = await media.normalise(path('screen'), {
      outPath: join(root, 'refused.mp4'),
      rate: FrameRate.of(30),
      width: 240,
      crop: { ...crop, y: 400 },
      signal,
    });
    expect(outside.ok ? 'ok' : outside.error.code).toBe('media.unsupported_media');
  }, 120_000);
});
