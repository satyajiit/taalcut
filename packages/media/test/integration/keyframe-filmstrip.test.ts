// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX2-T3 on real files: the filmstrip of a proxy is made from its keyframes
 * in one run, and each tile shows the last keyframe at or before its time.
 * The stand-in proxy has the proxy's shape (a closed GOP of half a second)
 * and one flat grey per GOP, so a tile's level says which keyframe it shows;
 * the exact read of the same file (each tile's own frame, in that same GOP)
 * gives the same levels. A short clip's tiles fall within one GOP: exact.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  countedContext,
  createDecodeTally,
  makeFilmstrip,
  runProcess,
  type FilmstripResult,
  type MediaContext,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder } from '../helpers/clip';
import { greyClipArgs, keyframeTimes, plannedClip, type PlannedClip } from '../helpers/keyframe-clips';

const found = await findTestBinaries('keyframe filmstrip');

const FPS = 30;
const GOP = 15;
/** One level per GOP. */
const gopLevel = (frame: number) => 16 + 5 * Math.floor(frame / GOP);
/** A video level as the JPEG sprite holds it: JPEG is full range, so 16–235 stretches to 0–255. */
const fullRange = (level: number) => Math.round(((level - 16) * 255) / 219);

type Clip = PlannedClip;

describe.skipIf(!found.binaries)('keyframe filmstrip', { timeout: 120_000 }, () => {
  let ctx: MediaContext;
  let dir: string;
  let proxy: Clip;
  let short: Clip;

  beforeAll(async () => {
    if (!found.binaries) throw new Error('no FFmpeg');
    ctx = { binaries: found.binaries };
    dir = await mkdtemp(join(tmpdir(), 'taalcut-keyframe-strip-'));
    const h264 = await h264Encoder(ctx);
    if (!h264) throw new Error('no H.264 encoder');
    const make = (file: string, seconds: number) =>
      plannedClip(
        ctx,
        join(dir, file),
        greyClipArgs({
          size: '320x180',
          fps: FPS,
          seconds,
          gop: GOP,
          level: `16+5*floor(N/${GOP})`,
          encoder: h264,
        }),
      );
    proxy = await make('proxy.mp4', 20);
    short = await make('short.mp4', 3);
  }, 240_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  async function strip(clip: Clip, alreadyNormalised: boolean) {
    const out = join(dir, `${alreadyNormalised}-strip.jpg`);
    const tally = createDecodeTally(clip.path);
    const made = await makeFilmstrip(clip.path, clip.plan, countedContext(ctx, tally), {
      out,
      alreadyNormalised,
    });
    if (!made.ok) throw new Error(`${made.error.code}: ${made.error.detail ?? ''}`);
    return { made: made.value, path: out, tally: tally.snapshot() };
  }

  /** Each tile's mean grey level, from the sprite JPEG. */
  async function tileLevels(path: string, made: FilmstripResult): Promise<number[]> {
    const { layout } = made;
    const gray = await runProcess(ctx.binaries.ffmpeg, [
      ...['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
    ]);
    if (!gray.ok) throw new Error(gray.error.code);
    const pixels = gray.value.stdout;
    return layout.tiles.map((tile) => {
      let sum = 0;
      // The tile's middle half: JPEG blocks bleed across tile edges.
      const [x0, y0] = [tile.x + Math.floor(tile.width / 4), tile.y + Math.floor(tile.height / 4)];
      const [w, h] = [Math.floor(tile.width / 2), Math.floor(tile.height / 2)];
      for (let y = y0; y < y0 + h; y++)
        for (let x = x0; x < x0 + w; x++) sum += pixels[y * layout.width + x] ?? 0;
      return Math.round(sum / (w * h));
    });
  }

  it('makes a proxy’s filmstrip from its keyframes: the last one at or before each tile', async () => {
    const keyframes = await keyframeTimes(ctx, proxy.path);
    // The stand-in has the proxy's shape: a keyframe every half second.
    expect(keyframes.slice(0, 3)).toEqual([0, 0.5, 1]);
    const { made, path, tally } = await strip(proxy, true);
    expect(made.source).toBe('keyframes');
    expect(tally).toMatchObject({ ffmpeg: 1, fullDecodes: 0 });
    const levels = await tileLevels(path, made);
    const expected = made.layout.tiles.map((tile) => {
      const seconds = tile.frame / FPS;
      const key = [...keyframes].reverse().find((k) => k <= seconds + 0.001) ?? 0;
      return fullRange(gopLevel(Math.round(key * FPS)));
    });
    levels.forEach((level, i) =>
      expect(Math.abs(level - (expected[i] ?? 0)), `tile ${i}`).toBeLessThanOrEqual(3),
    );
    // The last tile is the clip's last frame: it shows the last keyframe, not a blank tile.
    expect(levels[levels.length - 1]).toBeGreaterThan(200);
  });

  it('matches the exact read of the same file tile for tile', async () => {
    const keyed = await strip(proxy, true);
    const exact = await strip(proxy, false);
    expect(exact.made.source).toBe('exact');
    expect(exact.made.layout).toEqual(keyed.made.layout);
    const [a, b] = [await tileLevels(keyed.path, keyed.made), await tileLevels(exact.path, exact.made)];
    a.forEach((level, i) => expect(Math.abs(level - (b[i] ?? 0)), `tile ${i}`).toBeLessThanOrEqual(3));
  });

  it('reads exact frames when the tiles fall closer than a GOP', async () => {
    const { made } = await strip(short, true);
    expect(made.source).toBe('exact');
  });
});
