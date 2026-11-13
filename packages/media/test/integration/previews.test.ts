// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Waveform peaks from one short clip, and its poster frame from
 * `makeThumbnail` (five seeks since IX-D4): the same frame the old whole-file
 * select picked, encoded the same way within a few levels; an HLG clip's
 * thumbnail too (tone-mapped after a seek). The filmstrip is its own stage
 * since UX2 (filmstrip-stage.test.ts).
 */
import { readFile } from 'node:fs/promises';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makePreviews, makeThumbnail, type MediaContext } from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, planClip, renderClip } from '../helpers/clip';
import { makeFixtures } from '../helpers/fixtures';

const found = await findTestBinaries('media previews');

describe.skipIf(!found.binaries)('previews', () => {
  let dir: string;
  let ctx: MediaContext;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-previews-'));
    ctx = { binaries: found.binaries! };
  });
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('writes a JPEG thumbnail from five seeks and waveform peaks', async (t) => {
    const h264 = await h264Encoder(ctx);
    if (!h264) return t.skip('no H.264 encoder');
    const source = join(dir, 'clip.mp4');
    const encoded = await renderClip(ctx, source, [
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=320x240:rate=30:duration=2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:sample_rate=48000:duration=2',
      '-shortest',
      ...h264,
      '-c:a',
      'aac',
      '-fps_mode',
      'cfr',
    ]);
    if (!encoded) return t.skip('source was not encoded');
    const plan = await planClip(source, ctx);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    const outs = { waveform: join(dir, 'wave.bin') };
    const made = await makePreviews(source, plan.value, ctx, { out: outs });
    expect(made.ok, made.ok ? '' : made.error.detail).toBe(true);
    if (!made.ok) return;
    const thumbPath = join(dir, 'thumb.jpg');
    const thumbnail = await makeThumbnail(source, plan.value, ctx, thumbPath);
    expect(thumbnail.ok && thumbnail.value).toMatchObject({ width: 320, height: 240 });
    const thumb = await readFile(thumbPath);
    expect(thumb[0]).toBe(0xff);
    expect(thumb[1]).toBe(0xd8);
    const wave = await readFile(outs.waveform);
    expect(wave.readUInt32LE(0)).toBe(1);
    expect(wave.readUInt32LE(4)).toBe(100);
    expect(made.value.waveform?.bucketsPerSec).toBe(100);
    expect(made.value.waveform?.count).toBeGreaterThan(0);
  }, 120_000);

  it('picks a 10-bit HLG clip’s thumbnail from seeks, tone-mapped', async (t) => {
    const fixtures = await makeFixtures(ctx, ['hevcHlg']);
    try {
      const source = fixtures.paths.hevcHlg;
      if (!source) return t.skip(fixtures.missing.hevcHlg ?? 'no HLG clip');
      const plan = await planClip(source, ctx);
      if (!plan.ok) throw new Error(plan.error.code);
      expect(plan.value.toneMap).toBe('required');
      // Frames 2, 7, 12, 17 and 22 of 25: one window that starts with a seek.
      const thumbPath = join(dir, 'hlg-thumb.jpg');
      const thumbnail = await makeThumbnail(source, plan.value, ctx, thumbPath);
      expect(thumbnail.ok, thumbnail.ok ? '' : thumbnail.error.detail).toBe(true);
      expect(thumbnail.ok && thumbnail.value).toMatchObject({ width: 320, height: 240 });
      expect((await readFile(thumbPath))[0]).toBe(0xff);
    } finally {
      await rm(fixtures.dir, { recursive: true, force: true });
    }
  }, 120_000);
});
