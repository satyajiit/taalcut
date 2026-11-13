// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Loudness and silence stretches on short synthetic wavs. Skips without ffmpeg. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runFfmpeg, type MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { testMedia } from './helpers/ffmpeg';
import { measureAudio } from '../src/measure/measure';
import { rangeToMs } from '../src/rates';

async function render(ctx: MediaContext, args: readonly string[], dest: string): Promise<void> {
  const result = await runFfmpeg(ctx, [...args, dest]);
  expect(result.ok, result.ok ? '' : (result.error.detail ?? result.error.code)).toBe(true);
}

describe('measureAudio', () => {
  let ctx: MediaContext | undefined;
  let dir = '';

  beforeAll(async () => {
    const media = await testMedia('measure');
    if (!media.ctx) {
      console.warn(media.skip);
      return;
    }
    ctx = media.ctx;
    dir = await mkdtemp(join(tmpdir(), 'taalcut-measure-'));
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('treats 2 s of digital silence as silent', async () => {
    if (!ctx) return;
    const path = join(dir, 'silence.wav');
    await render(ctx, ['-y', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '2', '-c:a', 'pcm_s16le'], path);
    const result = await measureAudio(path, undefined, ctx);
    expect(result.ok, result.ok ? '' : (result.error.detail ?? result.error.code)).toBe(true);
    if (!result.ok) return;
    expect(result.value.integratedLufs).toBeLessThan(-50);
    expect(result.value.nonSilentRatio).toBeLessThan(0.05);
    expect(result.value.durationMs).toBeGreaterThan(1500);
  }, 60_000);

  it('treats a 2 s 440 Hz tone as not silent', async () => {
    if (!ctx) return;
    const path = join(dir, 'tone.wav');
    await render(
      ctx,
      ['-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=48000:duration=2', '-c:a', 'pcm_s16le'],
      path,
    );
    const result = await measureAudio(path, undefined, ctx);
    expect(result.ok, result.ok ? '' : (result.error.detail ?? result.error.code)).toBe(true);
    if (!result.ok) return;
    expect(result.value.integratedLufs).toBeGreaterThan(-50);
    expect(result.value.nonSilentRatio).toBeGreaterThan(0.9);
    expect(result.value.slices.length).toBeGreaterThan(0);
    expect(result.value.slices.length).toBeLessThanOrEqual(3);
  }, 60_000);

  it('keeps slices on either side of a 1 s gap', async () => {
    if (!ctx) return;
    const path = join(dir, 'gap.wav');
    await render(
      ctx,
      [
        '-y',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=1',
        '-f',
        'lavfi',
        '-i',
        'anullsrc=r=48000:cl=mono',
        '-f',
        'lavfi',
        '-i',
        'sine=frequency=440:sample_rate=48000:duration=1',
        '-filter_complex',
        '[1:a]atrim=0:1,asetpts=PTS-STARTPTS[s];[0:a][s][2:a]concat=n=3:v=0:a=1',
        '-c:a',
        'pcm_s16le',
      ],
      path,
    );
    const result = await measureAudio(path, undefined, ctx);
    expect(result.ok, result.ok ? '' : (result.error.detail ?? result.error.code)).toBe(true);
    if (!result.ok) return;
    expect(result.value.stretches).toHaveLength(2);
    expect(result.value.slices).toHaveLength(2);
    const [first, second] = result.value.stretches.map((stretch) => rangeToMs(stretch));
    const [sliceA, sliceB] = result.value.slices.map((slice) => rangeToMs(slice));
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(sliceA).toBeDefined();
    expect(sliceB).toBeDefined();
    if (!first || !second || !sliceA || !sliceB) return;
    expect(second.startMs - first.endMs).toBeGreaterThan(700);
    expect(sliceB.startMs - sliceA.endMs).toBeGreaterThan(700);
    expect(sliceA.endMs).toBeLessThanOrEqual(first.endMs + 50);
    expect(sliceB.startMs).toBeGreaterThanOrEqual(second.startMs - 50);
  }, 60_000);
});
