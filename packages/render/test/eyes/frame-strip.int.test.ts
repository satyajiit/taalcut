// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * MATCH1 eyes: library.frameStrip shows a stretch of a clip as frames with their times on them, so the instant
 * something happens can be read off it. The clip here is made up: a dark ground at 60 frames a second on which a
 * white square appears at frame 137 (2.283 s). The test reads the strip as a model would (which tile is the first
 * with the square), asks again between the two tiles around it, and ends on the frame.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, ok } from '@taalcut/core';
import { softwareH264FixtureFlags } from '@taalcut/media/test-support';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { frameStripTool, stripFrames, STRIP_TILES_MAX } from '../../src/eyes/frame-strip';
import { ffmpeg, findTestMedia, mediaContext, tempDir } from '../support/media';
import { eyesContext, runTool } from './support';

const media = await findTestMedia('library.frameStrip');
const APPEARS = 137;
const FPS = 60;
/** A 360x640 clip's tile at 256 on its long side, and the gap between tiles. */
const TILE = { width: 144, height: 256 };
const GAP = 4;

interface Strip {
  from: number;
  to: number;
  clipSeconds: number;
  columns: number;
  rows: number;
  step: number;
  everyFrame: boolean;
  tiles: { tile: number; seconds: number }[];
  image: { id: string; mediaType: string };
  pictures: { footage: string };
  note?: string;
}

describe('the frames a strip shows', () => {
  it('are both ends and the rest evenly between, each once', () => {
    expect(stripFrames(0, 239, 12)).toEqual([0, 22, 43, 65, 87, 109, 130, 152, 174, 196, 217, 239]);
    expect(stripFrames(130, 152, 24)).toEqual(Array.from({ length: 23 }, (_, index) => 130 + index));
    expect(stripFrames(10, 11, 12)).toEqual([10, 11]);
    expect(stripFrames(10, 10, 12)).toEqual([10]);
  });
});

describe.skipIf(!media.binaries)('library.frameStrip', { timeout: 180_000 }, () => {
  let work: Awaited<ReturnType<typeof tempDir>>;
  let clip: string;
  let photo: string;
  const assetId = newId<'Asset'>();
  const ctx = () => mediaContext(media.binaries!);
  const tool = (path: () => string, shown = true) =>
    frameStripTool({
      assets: { original: async () => ok({ path: path(), size: 1, mtimeMs: 0 }) },
      media: async () => ctx(),
      scratch: work.dir,
      ...(shown ? { pictures: async () => ({ shown: true, why: 'On this Mac.' }) } : {}),
    });

  beforeAll(async () => {
    work = await tempDir('eyes-frame-strip');
    clip = join(work.dir, 'clip.mp4');
    photo = join(work.dir, 'photo.jpg');
    const square = `drawbox=x=100:y=240:w=160:h=160:color=white:t=fill:enable='gte(n,${APPEARS})'`;
    await ffmpeg(ctx(), [
      ...['-f', 'lavfi', '-i', `color=c=0x202020:s=360x640:r=${FPS}:d=4,${square}`],
      ...['-pix_fmt', 'yuv420p', ...softwareH264FixtureFlags(), clip],
    ]);
    await ffmpeg(ctx(), ['-f', 'lavfi', '-i', 'color=c=gray:s=360x640:d=1', '-frames:v', '1', photo]);
  });
  afterAll(async () => {
    await work?.dispose();
  });

  /** Which tiles of a strip have the white square, read from the picture itself. */
  async function lit(world: ReturnType<typeof eyesContext>, strip: Strip): Promise<boolean[]> {
    const jpeg = join(work.dir, `${strip.image.id}.jpg`);
    const raw = join(work.dir, `${strip.image.id}.rgb`);
    await writeFile(jpeg, world.stored.get(strip.image.id)!.data);
    await ffmpeg(ctx(), ['-i', jpeg, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
    const rgb = await readFile(raw);
    const width = strip.columns * TILE.width + (strip.columns - 1) * GAP;
    expect(rgb.length).toBe(width * (strip.rows * TILE.height + (strip.rows - 1) * GAP) * 3);
    return strip.tiles.map((_, index) => {
      const x = (index % strip.columns) * (TILE.width + GAP) + TILE.width / 2;
      const y = Math.floor(index / strip.columns) * (TILE.height + GAP) + TILE.height / 2;
      return rgb[(y * width + x) * 3]! > 128;
    });
  }

  async function strip(world: ReturnType<typeof eyesContext>, input: Record<string, unknown>) {
    const run = await runTool(
      tool(() => clip),
      { assetId, ...input },
      world.ctx,
    );
    if (!run.ok) throw new Error(run.error.detail ?? run.error.code);
    return run.value as unknown as Strip;
  }

  it('shows the stretch as labelled tiles, and narrowing between two tiles ends on the frame it happens', async () => {
    const world = eyesContext();
    const whole = await strip(world, { from: 0, to: 4 });
    expect(whole).toMatchObject({
      from: 0,
      to: 3.983,
      clipSeconds: 4,
      columns: 6,
      rows: 2,
      everyFrame: false,
    });
    expect(whole.tiles).toHaveLength(12);
    expect(whole.tiles.map((tile) => tile.tile)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(whole.step).toBeCloseTo(3.983 / 11, 2);
    expect(whole.image.mediaType).toBe('image/jpeg');
    expect(whole.note).toBeUndefined();

    // Read as a model reads it: the last tile without the square, the first with it; then look between them.
    let seen = whole;
    let rounds = 0;
    for (; rounds < 4 && !seen.everyFrame; rounds++) {
      const on = await lit(world, seen);
      const first = on.indexOf(true);
      expect(first).toBeGreaterThan(0);
      expect(on.slice(first).every(Boolean)).toBe(true);
      seen = await strip(world, {
        from: seen.tiles[first - 1]!.seconds,
        to: seen.tiles[first]!.seconds,
        tiles: STRIP_TILES_MAX,
      });
    }
    expect(rounds).toBe(1);
    expect(seen.everyFrame).toBe(true);
    expect(seen.step).toBeCloseTo(1 / FPS, 3);
    const on = await lit(world, seen);
    // The time the strip gives for the instant is the frame's own: 137 / 60.
    expect(seen.tiles[on.indexOf(true)]!.seconds).toBe(Math.round((APPEARS / FPS) * 1000) / 1000);
    expect(seen.tiles[on.indexOf(true) - 1]!.seconds).toBe(Math.round(((APPEARS - 1) / FPS) * 1000) / 1000);
  });

  it('goes to the model as a picture only where the person’s frames may, and the artifact is there either way', async () => {
    const world = eyesContext();
    const shown = tool(() => clip);
    const run = await runTool(shown, { assetId, from: 1, to: 2, tiles: 4 }, world.ctx);
    if (!run.ok) throw new Error(run.error.code);
    expect(shown.images?.(run.value as never)).toEqual([run.value.image]);
    const kept = tool(() => clip, false);
    const here = await runTool(kept, { assetId, from: 1, to: 2, tiles: 4 }, world.ctx);
    if (!here.ok) throw new Error(here.error.code);
    expect((here.value as unknown as Strip).pictures.footage).toBe('kept');
    expect(kept.images?.(here.value as never)).toEqual([]);
    expect(world.stored.has((here.value as unknown as Strip).image.id)).toBe(true);
  });

  it('says what it could not show as asked: past the clip’s end, fewer frames than tiles, a photo', async () => {
    const world = eyesContext();
    const past = await strip(world, { from: 3.5, to: 9, tiles: 6 });
    expect(past.to).toBe(3.983);
    expect(past.note).toBe(
      'The clip runs 0 to 4 s at 60 frames a second; this stretch has 30 frames, 6 shown.',
    );
    const few = await strip(world, { from: 1, to: 1.05, tiles: 12 });
    expect(few.tiles.map((tile) => tile.seconds)).toEqual([1, 1.017, 1.033, 1.05]);
    expect(few.everyFrame).toBe(true);
    expect(few.note).toContain('this stretch has 4 frames, 4 shown');

    const beyond = await runTool(
      tool(() => clip),
      { assetId, from: 5, to: 6 },
      world.ctx,
    );
    expect(beyond.ok ? null : [beyond.error.code, beyond.error.detail]).toEqual([
      'core.validation',
      'Give from < to inside the clip, which runs 0 to 4 s',
    ]);
    const still = await runTool(
      tool(() => photo),
      { assetId, from: 0, to: 1 },
      world.ctx,
    );
    expect(still.ok ? null : still.error.detail).toBe('This is a photo, one frame: library.frameAt shows it');
    const offline = frameStripTool({
      assets: { original: async () => ok(null) },
      media: async () => ctx(),
      scratch: work.dir,
    });
    const gone = await runTool(offline, { assetId, from: 0, to: 1 }, world.ctx);
    expect(gone.ok ? null : gone.error.code).toBe('core.not_found');
    const blind = frameStripTool({
      assets: { original: async () => ok({ path: clip, size: 1, mtimeMs: 0 }) },
      media: async () => null,
      scratch: work.dir,
    });
    const none = await runTool(blind, { assetId, from: 0, to: 1 }, world.ctx);
    expect(none.ok ? null : none.error.code).toBe('core.not_implemented');
  });
});
