// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TRIM1: the part's arithmetic. What a scene plays of its file, where the part may go (inside one shot of the
 * file), which command takes it there, and how far an end can move before the clip or its neighbour runs out.
 */
import {
  EDITOR_COMMANDS,
  MIN_CLIP_FRAMES,
  TIMELINE_COMMANDS,
  type Filmstrip,
  type SpeedRamp,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { coverStyle } from '../src/features/timeline/clip-part/cover-style';
import { fractionAt, msAt, partOf, shotAtFrame } from '../src/features/timeline/clip-part/part-model';
import {
  cutGrid,
  edgeRange,
  edgeStep,
  edgeTo,
  moveCommand,
  moveSpans,
  moveStep,
  moveTo,
  moveToEnd,
} from '../src/features/timeline/clip-part/part-moves';
import { playedFrames, speedAtFrame } from '../src/features/timeline/clip-part/source-span';
import { CUT, FILE, fileDetail, FILE_FRAMES, partFixture, SHOT_A, SHOT_B } from './clip-part-support';

/** A speed ramp over canvas frames: `[frame, speed]` points. */
const rampOf = (curve: SpeedRamp['curve'], ...points: [number, number][]): SpeedRamp =>
  ({
    curve,
    points: points.map(([value, speed]) => ({ at: { value, rate: { num: 30, den: 1 } }, speed })),
  }) as SpeedRamp;

const partFor = (options: Parameters<typeof partFixture>[0] = {}) => {
  const f = partFixture(options);
  return { ...f, part: partOf(f.clip, f.model, fileDetail())! };
};

describe('the part a scene plays (TRIM1)', () => {
  it('is the clip’s own range in its file, with the file’s shots', () => {
    const { part, clip } = partFor();
    expect(part).toMatchObject({ assetId: FILE, shotId: SHOT_A, from: 30, to: 60, needs: 30 });
    expect([part.fileFrom, part.fileTo]).toEqual([0, FILE_FRAMES]);
    expect(part.shots).toEqual([
      { id: SHOT_A, from: 0, to: CUT },
      { id: SHOT_B, from: CUT, to: FILE_FRAMES },
    ]);
    expect([part.cutIn, part.cutOut]).toEqual([clip.start, clip.end]);
    expect(msAt(part, 30)).toBeCloseTo(1000, 6);
    expect(fractionAt(part, 150)).toBe(0.5);
    expect(shotAtFrame(part, 119)?.id).toBe(SHOT_A);
    expect(shotAtFrame(part, 120)?.id).toBe(SHOT_B);
  });

  it('knows no shots until the file’s own detail has loaded, and has none for a photo or a held moment', () => {
    const f = partFixture();
    expect(partOf(f.clip, f.model)?.shots).toEqual([]);
    expect(partOf(f.clip, f.model, null)?.shots).toEqual([]);
    const other = {
      ...fileDetail(),
      asset: { ...fileDetail().asset, id: f.model.clips[0]!.item.media.assetId },
    };
    expect(partOf(f.clip, f.model, other)?.shots).toEqual([]);
    const held = partFixture({ patch: (clip) => ({ ...clip, holdFrame: clip.sourceStart }) });
    expect(partOf(held.clip, held.model, fileDetail())).toBeNull();
    const photo = partFixture({
      patch: (clip) => ({ ...clip, media: { kind: 'image', assetId: FILE, shotId: null } }) as typeof clip,
    });
    expect(partOf(photo.clip, photo.model, fileDetail())).toBeNull();
  });

  it('counts the file’s frames a faster or slower scene uses', () => {
    const double = rampOf('hold', [0, 2]);
    const fast = partFor({ patch: (clip) => ({ ...clip, speed: double }) });
    expect([fast.part.from, fast.part.to, fast.part.needs]).toEqual([30, 90, 60]);
    expect(playedFrames(null, 30)).toBe(30);
    expect(playedFrames(rampOf('hold', [0, 0.5]), 30)).toBe(15);
    expect(speedAtFrame(double, 10)).toBe(2);
    // From real time to double speed over 30 frames, in a straight line: 45 frames of the file, at 1.5 halfway.
    const rising = rampOf('linear', [0, 1], [30, 2]);
    expect(playedFrames(rising, 30)).toBeCloseTo(45, 6);
    expect(speedAtFrame(rising, 15)).toBeCloseTo(1.5, 6);
    expect(speedAtFrame(rising, 30)).toBe(2);
  });

  it('says who stands beside the scene and how much each can give', () => {
    const { part, model } = partFor();
    const before = model.positions[1]!;
    expect(part.before).toMatchObject({ kind: 'scene', number: 2 });
    expect(part.before!.gives).toBe(before.end - before.start - MIN_CLIP_FRAMES);
    expect(part.after).toMatchObject({ kind: 'scene', number: 4 });
    expect(partFor({ index: 0 }).part.before).toBeNull();
  });
});

describe('moving the part (TRIM1)', () => {
  it('may start anywhere the whole part stays inside one shot', () => {
    const { part } = partFor();
    expect(moveSpans(part).map((span) => [span.low, span.high, span.shot?.id, span.home])).toEqual([
      [0, CUT - 30, SHOT_A, true],
      [CUT, FILE_FRAMES - 30, SHOT_B, false],
    ]);
  });

  it('stays in its shot as a slip, crosses into the other shot as a swap, and never straddles the cut', () => {
    const { part } = partFor();
    expect(moveTo(part, 50)).toMatchObject({ from: 50, command: 'slip' });
    expect(moveTo(part, 30)).toMatchObject({ from: 30, command: null });
    expect(moveTo(part, 200)).toMatchObject({ from: 200, command: 'swap', shot: { id: SHOT_B } });
    // 100 would play across the cut at 120: the nearer side wins.
    expect(moveTo(part, 100)).toMatchObject({ from: 90, command: 'slip' });
    expect(moveTo(part, 112)).toMatchObject({ from: 120, command: 'swap' });
    expect(moveTo(part, -40).from).toBe(0);
    expect(moveTo(part, 9999).from).toBe(FILE_FRAMES - 30);
  });

  it('leaves out a shot the scene doesn’t fit in', () => {
    const { part } = partFor({ frames: 150 });
    // Five seconds: the first shot is four. It stays where it is there, and fits only in the second.
    expect(moveSpans(part).map((span) => [span.low, span.high, span.home])).toEqual([
      [0, 30, true],
      [CUT, FILE_FRAMES - 150, false],
    ]);
  });

  it('goes anywhere in the file while its shots aren’t known, and lets the command decide', () => {
    const f = partFixture();
    const part = partOf(f.clip, f.model)!;
    expect(moveTo(part, 200)).toMatchObject({ from: 200, command: 'slip', shot: null });
  });

  it('steps to the end of its shot first, then on to the next shot', () => {
    const { part } = partFor();
    expect(moveStep(part, 30, 1).from).toBe(31);
    expect(moveStep(part, 80, 15)).toMatchObject({ from: 90, command: 'slip' });
    expect(moveStep(part, 90, 1)).toMatchObject({ from: CUT, command: 'swap' });
    expect(moveStep(part, CUT, -1)).toMatchObject({ from: 90, command: 'slip' });
    expect(moveStep(part, 0, -1).from).toBe(0);
    expect(moveToEnd(part, 30, 'first').from).toBe(0);
    expect(moveToEnd(part, 30, 'last').from).toBe(90);
  });

  it('is sent as timeline.slipClip with the first frame, or timeline.swapClip with the other shot', () => {
    const { part, clip } = partFor();
    const id = clip.item.id;
    expect(moveCommand(part, id, moveTo(part, 30))).toBeNull();
    expect(moveCommand(part, id, moveTo(part, 50))).toEqual({
      name: EDITOR_COMMANDS.slipClip,
      payload: { clipId: id, sourceStart: { value: 50, rate: { num: 30, den: 1 } } },
    });
    expect(moveCommand(part, id, moveTo(part, 200))).toEqual({
      name: TIMELINE_COMMANDS.swapClip,
      payload: {
        clipId: id,
        media: { assetId: FILE, shotId: SHOT_B },
        sourceStart: { value: 200, rate: { num: 30, den: 1 } },
        from: 'search',
      },
    });
  });
});

describe('moving an end (TRIM1)', () => {
  it('goes as far as the clip’s footage and the scene beside it allow', () => {
    const { part } = partFor();
    const end = edgeRange(part, 'end')!;
    expect(end.max).toBe(Math.min(FILE_FRAMES - 60, part.after!.gives));
    expect(end.min).toBe(-(30 - MIN_CLIP_FRAMES));
    const start = edgeRange(part, 'start')!;
    // One second of the file lies before the part.
    expect(start.max).toBe(Math.min(30, part.before!.gives));
    expect(start.atMax).toBe(30 <= part.before!.gives ? 'footage' : 'neighbour');
    expect(end.atMin).toBe('shortest');
  });

  it('has no beginning to move in the video’s first scene, and only the clip to stop its last', () => {
    const first = partFor({ index: 0 });
    expect(edgeRange(first.part, 'start')).toBeNull();
    expect(edgeTo(first.part, 'start', 0, null).by).toBe(0);
    const f = partFixture();
    const last = partFor({ index: f.model.clips.length - 1 });
    expect(last.part.after).toBeNull();
    expect(edgeRange(last.part, 'end')).toMatchObject({ max: FILE_FRAMES - 60, atMax: 'footage' });
  });

  it('follows the pointer in canvas frames, stops at its limits and says what stopped it', () => {
    const { part } = partFor();
    const range = edgeRange(part, 'end')!;
    expect(edgeTo(part, 'end', 70, null)).toMatchObject({ by: 10, from: 30, to: 70, stop: null });
    expect(edgeTo(part, 'end', 45, null)).toMatchObject({ by: -15, to: 45, stop: null });
    expect(edgeTo(part, 'end', 9999, null)).toMatchObject({ by: range.max, stop: range.atMax });
    expect(edgeTo(part, 'end', 31, null)).toMatchObject({ by: range.min, stop: 'shortest' });
    expect(edgeTo(part, 'start', 20, null)).toMatchObject({ by: 10, from: 20, to: 60 });
  });

  it('lands on a beat when the video has one, and steps from beat to beat', () => {
    const { part } = partFor();
    const cut = part.cutOut;
    const grid = { points: [cut - 12, cut, cut + 12, cut + 24], reach: 48 };
    expect(edgeTo(part, 'end', 60 + 5, grid).by).toBe(0);
    expect(edgeTo(part, 'end', 60 + 8, grid).by).toBe(12);
    expect(edgeStep(part, 'end', 0, 1, false, grid).by).toBe(12);
    expect(edgeStep(part, 'end', 12, -1, false, grid).by).toBe(0);
    expect(edgeStep(part, 'end', 0, 1, false, null).by).toBe(1);
    expect(edgeStep(part, 'end', 0, 1, true, null).by).toBe(15);
    // A step that can go nowhere says why.
    const range = edgeRange(part, 'end')!;
    expect(edgeStep(part, 'end', range.max, 1, false, null)).toMatchObject({
      by: range.max,
      stop: range.atMax,
    });
  });

  it('reads the beats from the timeline: none without a beat map', () => {
    expect(cutGrid(partFixture().model)).toBeNull();
    const onBeat = partFixture({ beats: true }).model;
    const grid = cutGrid(onBeat)!;
    expect(grid.points).toEqual(expect.arrayContaining([...onBeat.beats]));
    expect(grid.reach).toBe(onBeat.beatFrames * 2);
  });
});

describe('a filmstrip frame covering a box of any size (TRIM1)', () => {
  const strip = { columns: 4, rows: 2, tileWidth: 90, tileHeight: 160 } as Filmstrip;

  it('fills a box of the frame’s own shape with exactly one tile', () => {
    expect(coverStyle(strip, 's.jpg', 5, 90 / 160)).toMatchObject({
      backgroundSize: '400% 200%',
      // The second column of four, the second row of two.
      backgroundPosition: '33.333% 100%',
    });
  });

  it('covers a wider box by its width and centres the frame’s height', () => {
    const style = coverStyle(strip, 's.jpg', 0, 16 / 9);
    // The tile is as wide as the box and (16/9) / (90/160) times as tall.
    expect(style.backgroundSize).toBe('400% 632.099%');
    expect(style.backgroundPosition).toBe('0% 20.302%');
  });
});
