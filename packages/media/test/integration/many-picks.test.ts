// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G3: many picked frames in one decode. FFmpeg's expression parser refuses a tree deeper than 100 levels
 * (libavutil/eval.c `MAX_DEPTH`), and a flat sum of `eq(n,i)` is one level a frame, so a breakdown asking for
 * three frames a shot failed (`media.ffmpeg_failed`) from about 34 shots. 120 and 400 picks (sparse, in runs,
 * shuffled, with repeats) come back once each, in order, each the bytes a full pass reads at that index:
 * through `sampleFrames`, through the frame sets' branch graph, and on a contact sheet.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  contactSheet,
  decodeFrameSets,
  readFrameSlots,
  sampleFrames,
  type MediaContext,
  type NormalisationPlan,
} from '@taalcut/media';
import { findTestBinaries } from '../helpers/binaries';
import { h264Encoder, planClip, renderClip } from '../helpers/clip';

const found = await findTestBinaries('media many picks');
const SIZE = { width: 64, height: 48 };
const FRAMES = 1200;

/** 100 sparse frames 9 to 13 apart, then a run of 20: 120 frames, asked out of order with repeats. */
const sparseAndRun = Array.from({ length: 100 }, (_, i) => i * 11 + (i % 3)).concat(
  Array.from({ length: 20 }, (_, i) => 1150 + i),
);
const asked120 = [...sparseAndRun].reverse().concat([0, 1150, 33, 1169]);
/** Every third frame: 400 frames, none next to another (the most terms an expression can need). */
const asked400 = Array.from({ length: 400 }, (_, i) => i * 3);
const ascending = (frames: readonly number[]) => [...new Set(frames)].sort((a, b) => a - b);

describe.skipIf(!found.binaries)('many picked frames in one decode', () => {
  let dir: string;
  let ctx: MediaContext;
  let path = '';
  let plan: NormalisationPlan | undefined;
  const full = new Map<number, Buffer>();

  const sample = async (frames?: readonly number[]) => {
    const got: { index: number; data: Buffer }[] = [];
    const done = await sampleFrames(path, plan!, ctx, {
      format: 'gray8',
      size: SIZE,
      ...(frames ? { frames } : {}),
      onFrame: ({ index, data }) => got.push({ index, data }),
    });
    if (!done.ok) throw new Error(`${done.error.code}: ${done.error.detail ?? ''}`);
    return got;
  };

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'taalcut-many-picks-'));
    ctx = { binaries: found.binaries! };
    const h264 = await h264Encoder(ctx);
    if (!h264) return;
    path = join(dir, 'long.mp4');
    // 40 s of testsrc2 (every frame differs: its clock and moving shapes), keyframes every 2 s.
    const made = await renderClip(ctx, path, [
      ...['-f', 'lavfi', '-i', `testsrc2=size=160x120:rate=30:duration=${FRAMES / 30}`],
      ...['-g', '60', ...h264],
    ]);
    if (!made) return;
    const planned = await planClip(path, ctx);
    if (planned.ok) plan = planned.value;
    for (const frame of await sample()) full.set(frame.index, frame.data);
  }, 240_000);
  afterAll(() => rm(dir, { recursive: true, force: true }));

  it('reads the whole grid, and neighbouring frames differ', (t) => {
    if (!plan) return t.skip('no clip');
    expect(full.size).toBe(FRAMES);
    for (const index of [0, 300, 1150, 1198]) {
      expect(full.get(index)!.equals(full.get(index + 1)!), `${index}`).toBe(false);
    }
  });

  it.for([
    ['120 sparse and in a run', asked120],
    ['400 apart', asked400],
  ] as const)('sampleFrames: %s', { timeout: 120_000 }, async ([, asked], t) => {
    if (!plan) return t.skip('no clip');
    const got = await sample(asked);
    const expected = ascending(asked);
    expect(got.map((f) => f.index)).toEqual(expected);
    for (const frame of got) expect(frame.data.equals(full.get(frame.index)!), `${frame.index}`).toBe(true);
  });

  it('frame sets: 120 frames in one seek window, the same bytes', { timeout: 120_000 }, async (t) => {
    if (!plan) return t.skip('no clip');
    const files = await decodeFrameSets(path, plan, ctx, {
      sets: [{ set: 'many', size: { ...SIZE, exact: true }, format: 'gray8', frames: asked120 }],
      dir,
      // One window for every frame, so one graph picks all 120.
      windowGapSeconds: 60,
    });
    if (!files.ok) throw new Error(`${files.error.code}: ${files.error.detail ?? ''}`);
    const file = files.value[0]!;
    expect(file.slots.map((slot) => slot.index)).toEqual(ascending(asked120));
    const read = await readFrameSlots(file.path, file.slots);
    if (!read.ok) throw new Error(read.error.code);
    for (const index of ascending(asked120)) {
      expect(read.value.get(index)?.equals(full.get(index)!), `${index}`).toBe(true);
    }
  });

  it('contact sheet: 120 tiles', { timeout: 120_000 }, async (t) => {
    if (!plan) return t.skip('no clip');
    const frames = ascending(asked120);
    const sheet = await contactSheet(path, plan, ctx, {
      frames,
      columns: 12,
      tileLongSide: 32,
      out: join(dir, 'sheet.jpg'),
    });
    if (!sheet.ok) throw new Error(`${sheet.error.code}: ${sheet.error.detail ?? ''}`);
    expect(sheet.value.tiles.map((tile) => tile.frame)).toEqual(frames);
    expect(sheet.value.bytes).toBeGreaterThan(0);
  });
});
